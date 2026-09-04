import type { ApiEvent, ApiMeetingSeries } from '../api/api'

/**
 * Handing an event to somebody's calendar app.
 *
 * Two routes out, because there are two kinds of calendar in the world and neither reads
 * the other's:
 *
 *   - Google takes a URL. Its template endpoint pre-fills a new-event form the person
 *     presses save on, which is the only flow that works when their calendar is a tab.
 *   - Everything else takes an `.ics` file. Samsung, Apple and Outlook all import one,
 *     and on a phone opening the file is the flow. That's why this is a download rather
 *     than a second URL scheme: `webcal:` would need somewhere to host the file, and a
 *     subscription somebody would then have to manage.
 *
 * A weekly meeting goes over as a recurring series, not one evening — one press and the
 * term is in your phone. The series stops at the end of the semester and finals week is
 * punched out with `EXDATE`, so what a member ends up with matches what the site's own
 * calendar shows.
 *
 * Everything here is a pure function over `ApiEvent`. No component, no fetch, and no
 * `Date` arithmetic on wall-clock strings — see `meetings.ts` for why that matters.
 */

/**
 * The campus zone, and the one place the browser needs to name it.
 *
 * `lib/lab/lab.ts` refuses to mirror a server rule and this doesn't break that: the rule
 * about when a meeting is lives on the server, which sends instants. This is a label
 * going into a file format that demands one — an `.ics` with a floating time lands an
 * hour out in November.
 */
const CAMPUS_ZONE = 'America/New_York'

/**
 * US daylight-saving rules, as a calendar file has to spell them.
 *
 * An `.ics` can't say "America/New_York" and leave it there — the importing app is
 * entitled to not know the zone, so the file carries the rule. Both transitions have
 * been fixed since 2007, so this is a constant rather than something to compute.
 *
 * Without it a weekly meeting anchored in October is an hour out for the whole of
 * November, which is exactly the bug the wall-clock columns exist to avoid.
 */
const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  `TZID:${CAMPUS_ZONE}`,
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0500',
  'TZOFFSETTO:-0400',
  'TZNAME:EDT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0400',
  'TZOFFSETTO:-0500',
  'TZNAME:EST',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
]

/** iCalendar's two-letter weekdays, indexed by `Date.getDay()`. */
const ICS_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const

const pad = (value: number, width = 2) => String(value).padStart(width, '0')

/** `20260903T180000Z` — an instant, in UTC, as both formats spell one. */
function utcStamp(iso: string): string {
  const at = new Date(iso)
  return (
    `${pad(at.getUTCFullYear(), 4)}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}` +
    `T${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}Z`
  )
}

const campusParts = new Intl.DateTimeFormat('en-US', {
  timeZone: CAMPUS_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  // The same trap `server/src/lab/labStatus.ts` documents: `hour12: false` renders
  // midnight as 24 on some ICU builds, which would put a date a day out.
  hourCycle: 'h23',
})

/**
 * `20260903T180000` — the same instant as campus wall-clock, with no `Z`.
 *
 * Paired with a `TZID`, this is what makes a recurring meeting survive the clocks going
 * back: the file says "six in the evening in Orlando", and the importing app applies the
 * rule in `VTIMEZONE`.
 */
function campusStamp(iso: string): string {
  const parts = campusParts.formatToParts(new Date(iso))
  const field = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '00'

  return (
    `${field('year')}${field('month')}${field('day')}` +
    `T${field('hour')}${field('minute')}${field('second')}`
  )
}

/** `20260903` — a date with no time, for an all-day entry. */
const campusDay = (iso: string) => campusStamp(iso).slice(0, 8)

/**
 * The characters iCalendar reserves, and the one that bites.
 *
 * A comma is a value separator in this format, so an unescaped one in a description
 * silently truncates it — and every second event description has a comma in it.
 */
const escapeText = (value: string) =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')

/**
 * Fold to 75 octets, as the spec requires and strict parsers enforce.
 *
 * Counted in bytes rather than characters: a description with an em dash in it is three
 * bytes for one character, so folding on `.length` produces lines that are legal by one
 * count and not the other. Outlook is the one that notices.
 */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line

  const out: string[] = []
  let current = ''
  let width = 0

  for (const char of line) {
    const size = new TextEncoder().encode(char).length
    // 74, leaving room for the leading space every continuation line carries.
    if (width + size > (out.length === 0 ? 75 : 74)) {
      out.push(current)
      current = ''
      width = 0
    }
    current += char
    width += size
  }
  out.push(current)

  return out.join('\r\n ')
}

/**
 * `FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=…` — the rule, and where it stops.
 *
 * `UNTIL` is in UTC with a `Z`, which the spec requires whenever `DTSTART` carries a
 * `TZID`. Getting this wrong is the classic way to produce a series that either never
 * ends or ends a day early.
 */
const recurrenceRule = (series: ApiMeetingSeries) =>
  `RRULE:FREQ=WEEKLY;BYDAY=${series.weekdays
    .map((day) => ICS_DAYS[day])
    .filter(Boolean)
    .join(',')};UNTIL=${utcStamp(series.untilDate)}`

/**
 * One `EXDATE` line per finals-week occurrence, or nothing.
 *
 * Grouped into a single line — the format allows a comma-separated list, and a dozen
 * separate `EXDATE` lines is a dozen chances for a parser to disagree. The instants come
 * from the server; nothing here recomputes which evenings finals eats.
 */
function exceptionDates(series: ApiMeetingSeries): string[] {
  if (series.skipDates.length === 0) return []

  return [
    `EXDATE;TZID=${CAMPUS_ZONE}:${series.skipDates
      .map((iso) => campusStamp(iso))
      .join(',')}`,
  ]
}

/** What the two exports call the thing, with the project's name in front. */
const titleOf = (event: ApiEvent) => event.title

/** The blurb, plus the sentence about the bounds when there are bounds. */
function detailOf(event: ApiEvent): string {
  const parts = [event.description?.trim()].filter(Boolean) as string[]

  if (event.meeting) {
    parts.push(seriesSummary(event.meeting))
  }
  if (event.registrationUrl) {
    parts.push(`Sign up: ${event.registrationUrl}`)
  }

  return parts.join('\n\n')
}

/**
 * "Repeats weekly until 13 December, and skips finals week (7-13 December)."
 *
 * Exported because the button prints it too — the person pressing it should know what
 * they're about to put in their calendar, and saying it in two places from two strings is
 * how the two drift.
 */
export function seriesSummary(series: ApiMeetingSeries): string {
  const until = new Date(series.untilDate).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
  })

  const base = `Repeats weekly until ${until}.`
  if (!series.skip) return base

  const from = new Date(series.skip.from).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })
  const to = new Date(series.skip.to).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })

  return `${base} The club pauses every project for finals week (${from} – ${to}), so those dates are left out.`
}

/**
 * A stable identity for the row, so re-importing updates rather than duplicates.
 *
 * A meeting occurrence's id already carries the project and the instant, which is exactly
 * the uniqueness a `UID` wants — but the series has to share one across every occurrence,
 * or adding the same term twice from two different evenings makes two overlapping series.
 */
const uidOf = (event: ApiEvent) =>
  event.meeting
    ? `meeting-${event.meeting.projectSlug}-${event.meeting.untilDate}@rccf`
    : `${event.id}@rccf`

/**
 * The whole `.ics`, as a string. CRLF throughout, which isn't a stylistic choice — the
 * spec says so and Outlook enforces it.
 */
export function icsFor(event: ApiEvent, now: Date = new Date()): string {
  const series = event.meeting ?? null

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Robotics Club of Central Florida//Website//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]

  // Only when something in the file refers to it. An all-day one-off carries no zoned
  // time at all, and a VTIMEZONE nothing points at is noise a strict parser is entitled
  // to complain about.
  if (!event.allDay) lines.push(...VTIMEZONE)

  lines.push(
    'BEGIN:VEVENT',
    `UID:${uidOf(event)}`,
    `DTSTAMP:${utcStamp(now.toISOString())}`,
  )

  if (event.allDay) {
    // A date with no time, and `DTEND` is exclusive — the day after the last one. Without
    // the +1 a one-day event imports as zero days long and disappears from most calendars.
    const endIso = event.endsAt ?? event.startsAt
    const endsNextDay = new Date(
      new Date(endIso).getTime() + 24 * 60 * 60 * 1000,
    ).toISOString()

    lines.push(
      `DTSTART;VALUE=DATE:${campusDay(event.startsAt)}`,
      `DTEND;VALUE=DATE:${campusDay(endsNextDay)}`,
    )
  } else {
    lines.push(`DTSTART;TZID=${CAMPUS_ZONE}:${campusStamp(event.startsAt)}`)
    if (event.endsAt) {
      lines.push(`DTEND;TZID=${CAMPUS_ZONE}:${campusStamp(event.endsAt)}`)
    }
  }

  if (series) {
    lines.push(recurrenceRule(series), ...exceptionDates(series))
  }

  lines.push(`SUMMARY:${escapeText(titleOf(event))}`)

  const detail = detailOf(event)
  if (detail) lines.push(`DESCRIPTION:${escapeText(detail)}`)
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`)
  if (event.registrationUrl) lines.push(`URL:${event.registrationUrl}`)

  lines.push('END:VEVENT', 'END:VCALENDAR')

  return lines.map(fold).join('\r\n')
}

/**
 * Google's pre-filled new-event form.
 *
 * Local-format times plus `ctz`, deliberately, rather than UTC instants: the pair is what
 * tells Google the series is anchored to a wall clock in Orlando, so its occurrences move
 * with the clocks the way the `.ics` ones do. UTC instants would be correct for the first
 * meeting and an hour out from November.
 */
export function googleCalendarUrl(event: ApiEvent): string {
  const dates = event.allDay
    ? `${campusDay(event.startsAt)}/${campusDay(
        new Date(
          new Date(event.endsAt ?? event.startsAt).getTime() +
            24 * 60 * 60 * 1000,
        ).toISOString(),
      )}`
    : `${campusStamp(event.startsAt)}/${campusStamp(
        event.endsAt ?? event.startsAt,
      )}`

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: titleOf(event),
    dates,
    ctz: CAMPUS_ZONE,
  })

  const detail = detailOf(event)
  if (detail) params.set('details', detail)
  if (event.location) params.set('location', event.location)

  if (event.meeting) {
    // Google takes the recurrence as raw iCalendar lines, newline-separated.
    // `URLSearchParams` percent-encodes the newline for us.
    params.set(
      'recur',
      [
        recurrenceRule(event.meeting),
        ...exceptionDates(event.meeting),
      ].join('\n'),
    )
  }

  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

/** A filename somebody will recognise in their downloads folder. */
export function icsFilename(event: ApiEvent): string {
  const base =
    event.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'event'

  return `${base}.ics`
}

/**
 * Hand the file to the browser.
 *
 * A Blob and a synthetic click rather than a `data:` URL: Safari refuses to download the
 * latter from a click it didn't consider a navigation, and the object URL has to be
 * revoked or the string stays in memory for the life of the page.
 */
export function downloadIcs(event: ApiEvent): void {
  const blob = new Blob([icsFor(event)], {
    type: 'text/calendar;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = icsFilename(event)
  document.body.append(link)
  link.click()
  link.remove()

  URL.revokeObjectURL(url)
}
