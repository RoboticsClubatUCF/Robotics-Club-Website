import { campusDate } from '../projects/meetings.js'

/**
 * Subscription feeds, written as iCalendar.
 *
 * The browser has its own writer in `web/src/lib/events/calendarLinks.ts` for the one-off
 * ADD TO CALENDAR download. That one exports a meeting as a rule with `EXDATE`s. A feed is
 * re-read by the calendar app every few hours, so it can afford one entry per meeting
 * instead, and that's what keeps it honest: the instants come straight out of
 * `expandMeetings`, so finals week, a lead's cancellation and the clocks changing are
 * already applied and there's no rule for an app to read differently.
 *
 * Every timed entry is in UTC for the same reason. No `VTIMEZONE` is needed when nothing
 * repeats.
 */

/** One entry in a feed. */
export interface FeedEntry {
  /** Stable across reads, so an app updates the entry rather than adding a second. */
  uid: string
  title: string
  description: string | null
  location: string | null
  startsAt: Date
  endsAt: Date | null
  allDay: boolean
  url: string | null
  /** A lead called this meeting off. It stays in the feed, marked, the way it stays on the site. */
  cancelled: boolean
}

export interface FeedHeader {
  /** What the app names the calendar when somebody subscribes. */
  name: string
  description: string
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0')

/** `20260903T220000Z`. */
const utcStamp = (at: Date) =>
  `${pad(at.getUTCFullYear(), 4)}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}` +
  `T${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}Z`

/** `20260903`, the campus date an instant falls on, `days` later. */
function campusDay(at: Date, days = 0): string {
  const [year = 0, month = 1, day = 1] = campusDate(at).split('-').map(Number)
  const moved = new Date(Date.UTC(year, month - 1, day + days))
  return `${pad(moved.getUTCFullYear(), 4)}${pad(moved.getUTCMonth() + 1)}${pad(moved.getUTCDate())}`
}

/** A comma is a value separator in this format, so an unescaped one truncates the text. */
const escapeText = (value: string) =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')

const encoder = new TextEncoder()

/** Fold to 75 octets, counted in bytes: an em dash is three of them, and Outlook notices. */
function fold(line: string): string {
  if (encoder.encode(line).length <= 75) return line

  const out: string[] = []
  let current = ''
  let width = 0

  for (const char of line) {
    const size = encoder.encode(char).length
    // 74 after the first line, leaving room for the space each continuation starts with.
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

function vevent(entry: FeedEntry, stamp: string): string[] {
  const lines = ['BEGIN:VEVENT', `UID:${entry.uid}`, `DTSTAMP:${stamp}`]

  if (entry.allDay) {
    // `DTEND` on a date is exclusive, so it's the day after the last one. Without the +1 a
    // one-day event is zero days long and most apps drop it.
    lines.push(
      `DTSTART;VALUE=DATE:${campusDay(entry.startsAt)}`,
      `DTEND;VALUE=DATE:${campusDay(entry.endsAt ?? entry.startsAt, 1)}`,
    )
  } else {
    lines.push(`DTSTART:${utcStamp(entry.startsAt)}`)
    if (entry.endsAt) lines.push(`DTEND:${utcStamp(entry.endsAt)}`)
  }

  lines.push(
    `SUMMARY:${escapeText(entry.cancelled ? `Cancelled: ${entry.title}` : entry.title)}`,
  )
  if (entry.cancelled) lines.push('STATUS:CANCELLED')
  if (entry.description) lines.push(`DESCRIPTION:${escapeText(entry.description)}`)
  if (entry.location) lines.push(`LOCATION:${escapeText(entry.location)}`)
  if (entry.url) lines.push(`URL:${entry.url}`)

  lines.push('END:VEVENT')
  return lines
}

/** The whole file. CRLF throughout, which the spec requires and Outlook enforces. */
export function calendarFile(
  header: FeedHeader,
  entries: FeedEntry[],
  now: Date = new Date(),
): string {
  const stamp = utcStamp(now)

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Robotics Club of Central Florida//Website//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(header.name)}`,
    `X-WR-CALDESC:${escapeText(header.description)}`,
    'X-WR-TIMEZONE:America/New_York',
    // How often to re-read. Apple and Outlook honour these; Google ignores them and
    // refreshes on its own schedule, roughly daily.
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...entries.flatMap((entry) => vevent(entry, stamp)),
    'END:VCALENDAR',
  ]

  return `${lines.map(fold).join('\r\n')}\r\n`
}
