import { CAMPUS_ZONE } from '../lab/labStatus.js'
import { MeetingRepeat, type Season } from '../generated/prisma/enums.js'
import { getTerm, type Term } from '../membership/semester.js'

/**
 * When a project meets, turned into occurrences on a calendar.
 *
 * The club's one recurring thing. A project stores what a lead would say out loud —
 * "every other Tuesday, six till ten, in the lab" — as columns rather than as generated
 * `Event` rows, and this expands them. It lives on the server because the landing page
 * is anonymous, the bounds come from UCF's calendar, and two implementations of "when
 * does this project meet" is the bug class this codebase keeps warning about.
 *
 * Two rules remove an occurrence: it stops at the end of the project's own term, and
 * finals week is skipped (unless nobody has said when finals is). A lead's cancellation
 * doesn't remove one. The occurrence stays, marked, so the calendar says the meeting is
 * off rather than going quiet about it.
 */

/** What the expander needs off a project row, and nothing else. */
export const meetingProjectSelect = {
  id: true,
  slug: true,
  title: true,
  termYear: true,
  termSeason: true,
  meetingRepeat: true,
  meetingWeekdays: true,
  meetingInterval: true,
  meetingMonthWeeks: true,
  meetingMonthDays: true,
  meetingDates: true,
  meetingStartsOn: true,
  meetingStartTime: true,
  meetingEndTime: true,
  meetingTimes: { select: { day: true, startTime: true, endTime: true } },
  meetingLocation: true,
  meetingDescription: true,
  meetingCancellations: { select: { date: true, reason: true } },
} as const

export interface MeetingProject {
  id: string
  slug: string
  title: string
  termYear: number
  termSeason: Season
  meetingRepeat: MeetingRepeat | null
  meetingWeekdays: number[]
  meetingInterval: number
  meetingMonthWeeks: number[]
  meetingMonthDays: number[]
  meetingDates: string[]
  meetingStartsOn: string | null
  meetingStartTime: string | null
  meetingEndTime: string | null
  meetingTimes: { day: string; startTime: string; endTime: string }[]
  meetingLocation: string | null
  meetingDescription: string | null
  meetingCancellations: { date: string; reason: string | null }[]
}

/**
 * The whole series in one object, carried on every occurrence.
 *
 * What lets a member press one button and have the term in their phone. A calendar app
 * wants a rule plus its exceptions, so the client gets the pattern, the hours, the last
 * date and the instants to leave out, rather than rebuilding them from guesses.
 *
 * Repeated on each occurrence rather than sent alongside: both calendars hand a flat
 * array to the same widget, and a parallel structure keyed by project would have to
 * survive every filter and sort that widget does.
 */
export interface MeetingSeries {
  projectSlug: string
  projectTitle: string
  repeat: MeetingRepeat
  /** 0-6, Sunday first, sorted. WEEKLY and MONTHLY_WEEKDAY. */
  weekdays: number[]
  /** WEEKLY: every this many weeks. */
  interval: number
  /** MONTHLY_WEEKDAY: 1-4, or -1 for the last. */
  monthWeeks: number[]
  /** MONTHLY_DAY: 1-28, or -1 for the last day. */
  monthDays: number[]
  /**
   * DATES: every date left standing this term, as instants, cancelled ones and finals
   * week already out. A list of dates has no rule a calendar app can repeat, so the
   * export writes one entry per date. Empty for the other patterns.
   */
  dates: { startsAt: string; endsAt: string }[]
  /** Campus wall-clock, "18:00". The usual hours; `hours` has the days that keep others. */
  startTime: string
  endTime: string
  /**
   * The series by its hours, the usual ones first, one entry when every day keeps them.
   * Empty for DATES, whose `dates` carry their own.
   */
  hours: MeetingHours[]
  location: string | null
  /** The last day the series runs: the end of the project's term, as ISO. */
  untilDate: string
  /** Finals week, which the series skips, or null when nobody has set one. */
  skip: { from: string; to: string } | null
  /**
   * The exact occurrences finals week eats, as ISO instants, for `EXDATE`. Each has to
   * name a real instant of the rule to the second, which is why it's worked out here.
   * Empty when no finals week is set, and for DATES.
   */
  skipDates: string[]
  /** The occurrences the lead cancelled, as ISO instants, for `EXDATE` the same way. */
  cancelledDates: string[]
}

/**
 * The part of a series that keeps one set of hours. A calendar rule carries one time, so a
 * schedule whose Thursdays run later goes into a calendar app as two rules.
 */
export interface MeetingHours {
  startTime: string
  endTime: string
  /** WEEKLY and MONTHLY_WEEKDAY: which of the pattern's weekdays keep these hours. */
  weekdays: number[]
  /** MONTHLY_DAY: which of its days of the month. */
  monthDays: number[]
  /** This part's share of the series' `skipDates` and `cancelledDates`. */
  skipDates: string[]
  cancelledDates: string[]
  /**
   * Its first meeting from the occurrence carrying it, passing over cancelled ones and
   * finals week, or null when none is left this term. The export starts each rule here,
   * which is why the series differs from one occurrence to the next.
   */
  next: { startsAt: string; endsAt: string } | null
}

/** One meeting, shaped like the events it sits beside on a calendar. */
export interface MeetingOccurrence {
  id: string
  slug: string
  title: string
  description: string | null
  type: 'MEETING'
  location: string | null
  startsAt: string
  endsAt: string
  allDay: false
  registrationUrl: null
  meeting: MeetingSeries
  /** Set when the lead called this one off. */
  cancelled: { reason: string | null } | null
  /** For the member view, which says which project a row came from. */
  projectId: string
  project: { slug: string; title: string }
}

/**
 * The longest window anybody may expand at once.
 *
 * A year and a bit, which covers the widest thing the site asks for and refuses the
 * request that would hurt: `?from=2020&to=2100` on a cached public endpoint. The term
 * bound already caps it in practice; this caps it before the work starts.
 */
export const MAX_WINDOW_DAYS = 400

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The campus clock, read the way `labStatus.ts` reads it and for the same reason:
 * Florida moves by an hour twice a year, so an offset held as a number is right for
 * eight months of it.
 */
const campusParts = new Intl.DateTimeFormat('en-US', {
  timeZone: CAMPUS_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  // The trap `labStatus.ts` documents: with `hour12: false` some ICU builds render
  // midnight as 24 and the arithmetic below lands a day out.
  hourCycle: 'h23',
})

interface CivilDate {
  year: number
  month: number
  day: number
}

function readCampus(at: Date): CivilDate & { hour: number; minute: number; second: number } {
  const parts = campusParts.formatToParts(at)
  const field = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0')

  return {
    year: field('year'),
    month: field('month'),
    day: field('day'),
    hour: field('hour'),
    minute: field('minute'),
    second: field('second'),
  }
}

/** How far the campus clock is from UTC at a given instant, in milliseconds. */
function campusOffsetMs(at: Date): number {
  const { year, month, day, hour, minute, second } = readCampus(at)
  return Date.UTC(year, month - 1, day, hour, minute, second) - at.getTime()
}

/**
 * The instant at which it is `hour:minute` on campus on a given civil date.
 *
 * Done by correction because there's no "parse in this zone" primitive: treat the wall
 * clock as UTC, ask what the offset is near that guess, subtract it. Corrected twice,
 * because the first guess can land on the wrong side of a DST transition.
 */
function campusInstant(
  { year, month, day }: CivilDate,
  hour: number,
  minute: number,
): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute)
  const first = new Date(wall - campusOffsetMs(new Date(wall)))
  return new Date(wall - campusOffsetMs(first))
}

/** "18:30" -> [18, 30], or null for anything that is not a wall-clock time. */
function readClock(time: string): [number, number] | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time)
  if (!match) return null
  return [Number(match[1]), Number(match[2])]
}

/** The civil date `days` after this one, without touching a timezone. */
function addDays(date: CivilDate, days: number): CivilDate {
  const moved = new Date(Date.UTC(date.year, date.month - 1, date.day + days))
  return {
    year: moved.getUTCFullYear(),
    month: moved.getUTCMonth() + 1,
    day: moved.getUTCDate(),
  }
}

/** Days since the epoch. Calendar arithmetic on a bare date, so no zone is involved. */
const dayNumber = (date: CivilDate) =>
  Date.UTC(date.year, date.month - 1, date.day) / DAY_MS

/** Which weekday a civil date is, 0-6 with Sunday first, as `Date.getDay()` has it. */
const weekdayOf = (date: CivilDate): number =>
  new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()

const daysInMonth = (date: CivilDate) =>
  new Date(Date.UTC(date.year, date.month, 0)).getUTCDate()

const beforeOrEqual = (a: CivilDate, b: CivilDate) => dayNumber(a) <= dayNumber(b)

const pad = (value: number) => String(value).padStart(2, '0')

/** "2026-09-23", the form every date column and every URL uses. */
const isoDate = (date: CivilDate) =>
  `${String(date.year)}-${pad(date.month)}-${pad(date.day)}`

/** The inverse, for strings the write routes already checked. */
function civilDate(iso: string): CivilDate {
  const [year = 0, month = 1, day = 1] = iso.split('-').map(Number)
  return { year, month, day }
}

/** The campus date an instant falls on, as "2026-09-23". */
export const campusDate = (at: Date) => isoDate(readCampus(at))

/** Midnight on campus on the day `at` falls on. */
export const startOfCampusDay = (at: Date) => campusInstant(readCampus(at), 0, 0)

type Clock = [number, number]

/** The pattern columns, read. Null when the row has no usable schedule. */
interface Rule {
  repeat: MeetingRepeat
  weekdays: number[]
  interval: number
  monthWeeks: number[]
  monthDays: number[]
  dates: Set<string>
  startsOn: CivilDate | null
  start: Clock
  end: Clock
  /** The days with hours of their own, keyed like `ProjectMeetingTime.day`. */
  own: Map<string, { start: Clock; end: Clock }>
}

function ruleOf(project: MeetingProject): Rule | null {
  if (!project.meetingRepeat) return null

  const start = readClock(project.meetingStartTime ?? '')
  const end = readClock(project.meetingEndTime ?? '')
  // A row whose times were written straight into Postgres. Skipped rather than guessed
  // at: a meeting drawn at midnight because "6pm-ish" wouldn't parse is worse than none.
  if (!start || !end) return null

  return {
    repeat: project.meetingRepeat,
    weekdays: [...new Set(project.meetingWeekdays)].sort((a, b) => a - b),
    interval: Math.max(1, project.meetingInterval),
    monthWeeks: project.meetingMonthWeeks,
    monthDays: project.meetingMonthDays,
    dates: new Set(project.meetingDates),
    startsOn: project.meetingStartsOn ? civilDate(project.meetingStartsOn) : null,
    start,
    end,
    // A day whose own hours don't parse keeps the usual ones, for the reason above.
    own: new Map(
      project.meetingTimes.flatMap((time) => {
        const from = readClock(time.startTime)
        const to = readClock(time.endTime)
        return from && to ? [[time.day, { start: from, end: to }] as const] : []
      }),
    ),
  }
}

/**
 * The `ProjectMeetingTime.day` a campus date is under this rule. The last day of February is
 * the 28th when the 28th is on the list, and the last day otherwise.
 */
function dayKey(rule: Rule, day: CivilDate): string {
  switch (rule.repeat) {
    case MeetingRepeat.DATES:
      return isoDate(day)
    case MeetingRepeat.MONTHLY_DAY:
      return rule.monthDays.includes(day.day) ? String(day.day) : '-1'
    default:
      return String(weekdayOf(day))
  }
}

const clockText = ([hour, minute]: Clock) => `${pad(hour)}:${pad(minute)}`

/**
 * The repeating patterns' days grouped by their hours, usual hours first, for the export.
 * Nothing for a list of dates, which is exported date by date.
 */
function hoursGroups(rule: Rule) {
  if (rule.repeat === MeetingRepeat.DATES) return []

  const usual = `${clockText(rule.start)}-${clockText(rule.end)}`
  const groups = new Map<string, string[]>([[usual, []]])
  const days =
    rule.repeat === MeetingRepeat.MONTHLY_DAY ? rule.monthDays : rule.weekdays

  for (const day of days.map(String)) {
    const own = rule.own.get(day)
    const hours = own ? `${clockText(own.start)}-${clockText(own.end)}` : usual
    groups.set(hours, [...(groups.get(hours) ?? []), day])
  }

  return [...groups].flatMap(([hours, keys]) => {
    const [startTime = '', endTime = ''] = hours.split('-')
    return keys.length > 0 ? [{ startTime, endTime, keys }] : []
  })
}

/**
 * Whether the pattern lands on a campus date, before the term and finals have a say.
 *
 * Every other week counts whole Sunday-to-Saturday weeks from the week `startsOn` is in,
 * which is what `WKST=SU` tells a calendar app, so the two agree on which weeks are on.
 * `termStart` stands in for a missing `startsOn`; the write routes require one for an
 * interval over 1, so that's only a row edited by hand.
 */
function patternLandsOn(rule: Rule, day: CivilDate, termStart: CivilDate): boolean {
  if (rule.repeat === MeetingRepeat.DATES) return rule.dates.has(isoDate(day))

  if (rule.startsOn && !beforeOrEqual(rule.startsOn, day)) return false

  const weekday = weekdayOf(day)

  switch (rule.repeat) {
    case MeetingRepeat.WEEKLY: {
      if (!rule.weekdays.includes(weekday)) return false
      if (rule.interval === 1) return true

      const anchor = rule.startsOn ?? termStart
      const anchorSunday = dayNumber(anchor) - weekdayOf(anchor)
      const weeks = (dayNumber(day) - weekday - anchorSunday) / 7
      return weeks >= 0 && weeks % rule.interval === 0
    }
    case MeetingRepeat.MONTHLY_WEEKDAY: {
      if (!rule.weekdays.includes(weekday)) return false
      const nth = Math.ceil(day.day / 7)
      const last = day.day + 7 > daysInMonth(day)
      return (
        rule.monthWeeks.includes(nth) || (last && rule.monthWeeks.includes(-1))
      )
    }
    case MeetingRepeat.MONTHLY_DAY:
      return (
        rule.monthDays.includes(day.day) ||
        (rule.monthDays.includes(-1) && day.day === daysInMonth(day))
      )
  }
}

/** The instants a meeting on this campus date runs between, on that day's own hours. */
function timesOn(rule: Rule, day: CivilDate) {
  const { start, end } = rule.own.get(dayKey(rule, day)) ?? rule
  return instantsOn(day, start, end)
}

function instantsOn(day: CivilDate, start: Clock, end: Clock) {
  const startsAt = campusInstant(day, start[0], start[1])
  let endsAt = campusInstant(day, end[0], end[1])
  // A meeting that ends before it starts ran past midnight. The write routes refuse one,
  // so this only reads rows written before they did.
  if (endsAt <= startsAt) endsAt = new Date(endsAt.getTime() + DAY_MS)
  return { startsAt, endsAt }
}

/**
 * Why the term won't have a meeting at these times, or null when it will.
 *
 * Finals is overlap rather than containment, so a meeting that begins the evening
 * finals starts is dropped too.
 */
function haltedBy(
  term: Term,
  startsAt: Date,
  endsAt: Date,
): 'outside' | 'finals' | null {
  if (startsAt < term.startsAt || startsAt > term.endsAt) return 'outside'
  if (
    term.finalsStartAt &&
    term.finalsEndAt &&
    startsAt <= term.finalsEndAt &&
    endsAt >= term.finalsStartAt
  ) {
    return 'finals'
  }
  return null
}

/**
 * Whether a meeting on `date` from `startTime` to `endTime` could happen in `term`.
 *
 * For the write routes, so a lead who picks a date in finals week or in the wrong year
 * is told so instead of watching it vanish from the calendar.
 */
export function dateProblem(
  term: Term,
  date: string,
  startTime: string,
  endTime: string,
): 'outside' | 'finals' | null {
  const start = readClock(startTime)
  const end = readClock(endTime)
  if (!start || !end) return null

  const { startsAt, endsAt } = instantsOn(civilDate(date), start, end)
  return haltedBy(term, startsAt, endsAt)
}

/**
 * Every occurrence of every project's meeting inside `[from, to)`.
 *
 * Terms are read once per distinct `(year, season)` rather than once per project.
 * `getTerm` caches for a day, but "usually free" is a property of the cache and this
 * loops over every project on the site.
 *
 * Half-open at the top, matching both calendar routes, so a meeting at midnight on the
 * 1st belongs to the month that's starting rather than to both.
 */
export async function expandMeetings(
  projects: MeetingProject[],
  from: Date,
  to: Date,
): Promise<MeetingOccurrence[]> {
  if (to <= from) return []
  if (to.getTime() - from.getTime() > MAX_WINDOW_DAYS * DAY_MS) {
    throw new RangeError(
      `A calendar window may cover at most ${String(MAX_WINDOW_DAYS)} days.`,
    )
  }

  const scheduled = projects.flatMap((project) => {
    const rule = ruleOf(project)
    return rule ? [{ project, rule }] : []
  })
  if (scheduled.length === 0) return []

  const termKey = (project: MeetingProject) =>
    `${String(project.termYear)}-${project.termSeason}`

  const terms = new Map<string, Term>()
  await Promise.all(
    [...new Set(scheduled.map(({ project }) => termKey(project)))].map(
      async (key) => {
        const [year, season] = key.split('-') as [string, Season]
        terms.set(key, await getTerm(Number(year), season))
      },
    ),
  )

  const occurrences: MeetingOccurrence[] = []

  for (const { project, rule } of scheduled) {
    const term = terms.get(termKey(project))
    if (!term) continue

    const termStart = readCampus(term.startsAt)
    const lands = (day: CivilDate) => patternLandsOn(rule, day, termStart)

    const cancellations = new Map(
      project.meetingCancellations.map((row) => [row.date, row.reason]),
    )

    // The instants a calendar app has to leave out, walked across the whole term rather
    // than the request window: somebody adding the series in September needs December's.
    // Each keeps its day, so the export hands it to the rule with that day's hours.
    const skipped: { key: string; at: string }[] = []
    const called: { key: string; at: string }[] = []
    const dates: MeetingSeries['dates'] = []
    // Every day the term has a meeting, and whether it goes ahead, for `MeetingHours.next`.
    const landings: { day: CivilDate; number: number; key: string; standing: boolean }[] =
      []
    const termEnd = readCampus(term.endsAt)

    // Only days that can matter get their instants worked out, since each is four `Intl`
    // calls and this runs per project per request: a listed date, a cancelled one, or one
    // within a day of finals week.
    const finalsFrom = term.finalsStartAt
      ? dayNumber(readCampus(term.finalsStartAt)) - 1
      : null
    const finalsTo = term.finalsEndAt
      ? dayNumber(readCampus(term.finalsEndAt)) + 1
      : null
    const nearFinals = (day: CivilDate) =>
      finalsFrom !== null &&
      finalsTo !== null &&
      dayNumber(day) >= finalsFrom &&
      dayNumber(day) <= finalsTo

    for (
      let day: CivilDate = termStart;
      beforeOrEqual(day, termEnd);
      day = addDays(day, 1)
    ) {
      if (!lands(day)) continue

      const key = dayKey(rule, day)
      const number = dayNumber(day)
      const cancelled = cancellations.has(isoDate(day))
      if (rule.repeat !== MeetingRepeat.DATES && !cancelled && !nearFinals(day)) {
        landings.push({ day, number, key, standing: true })
        continue
      }

      const { startsAt, endsAt } = timesOn(rule, day)
      const halted = haltedBy(term, startsAt, endsAt)
      if (halted === 'outside') continue
      landings.push({ day, number, key, standing: !halted && !cancelled })

      if (rule.repeat === MeetingRepeat.DATES) {
        if (!halted && !cancelled) {
          dates.push({
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
          })
        }
      } else if (halted === 'finals') {
        skipped.push({ key, at: startsAt.toISOString() })
      } else if (cancelled) {
        called.push({ key, at: startsAt.toISOString() })
      }
    }

    const groups = hoursGroups(rule)
    const firsts = new Map<number, MeetingHours['next']>()

    /** A group's first meeting that goes ahead on or after day number `from`. */
    const nextOf = (keys: string[], from: number): MeetingHours['next'] => {
      const found = landings.find(
        (landing) =>
          landing.standing && landing.number >= from && keys.includes(landing.key),
      )
      if (!found) return null

      if (!firsts.has(found.number)) {
        const { startsAt, endsAt } = timesOn(rule, found.day)
        firsts.set(found.number, {
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
        })
      }
      return firsts.get(found.number) ?? null
    }

    const hoursFrom = (from: number): MeetingHours[] =>
      groups.map(({ startTime, endTime, keys }) => ({
        startTime,
        endTime,
        weekdays: rule.repeat === MeetingRepeat.MONTHLY_DAY ? [] : keys.map(Number),
        monthDays: rule.repeat === MeetingRepeat.MONTHLY_DAY ? keys.map(Number) : [],
        skipDates: skipped
          .filter((each) => keys.includes(each.key))
          .map((each) => each.at),
        cancelledDates: called
          .filter((each) => keys.includes(each.key))
          .map((each) => each.at),
        next: nextOf(keys, from),
      }))

    const series: MeetingSeries = {
      projectSlug: project.slug,
      projectTitle: project.title,
      repeat: rule.repeat,
      weekdays: rule.weekdays,
      interval: rule.interval,
      monthWeeks: rule.monthWeeks,
      monthDays: rule.monthDays,
      dates,
      startTime: project.meetingStartTime ?? '',
      endTime: project.meetingEndTime ?? '',
      hours: [],
      location: project.meetingLocation,
      untilDate: term.endsAt.toISOString(),
      skip:
        term.finalsStartAt && term.finalsEndAt
          ? {
              from: term.finalsStartAt.toISOString(),
              to: term.finalsEndAt.toISOString(),
            }
          : null,
      skipDates: skipped.map((each) => each.at),
      cancelledDates: called.map((each) => each.at),
    }

    // Walk the campus calendar, not the UTC one — which Tuesday a meeting falls on is
    // decided in Orlando. One day of slack at each end so an occurrence starting on the
    // campus day before `from` but running into the window still lands.
    const walkTo = addDays(readCampus(to), 1)

    for (
      let day = addDays(readCampus(from), -1);
      beforeOrEqual(day, walkTo);
      day = addDays(day, 1)
    ) {
      if (!lands(day)) continue

      const { startsAt, endsAt } = timesOn(rule, day)
      if (haltedBy(term, startsAt, endsAt)) continue

      // The requested window, half-open, applied last so the bounds above decide
      // whether a meeting exists at all.
      if (startsAt < from || startsAt >= to) continue

      const date = isoDate(day)

      occurrences.push({
        // The `meeting:` prefix tells the browser there's no row behind this, so no
        // page offers to edit it.
        id: `meeting:${project.id}:${startsAt.toISOString()}`,
        slug: project.slug,
        title: `${project.title} meeting`,
        // The lead's own note, or nothing. The site doesn't write one for them.
        description: project.meetingDescription,
        type: 'MEETING',
        location: project.meetingLocation,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        allDay: false,
        registrationUrl: null,
        meeting: { ...series, hours: hoursFrom(dayNumber(day)) },
        cancelled: cancellations.has(date)
          ? { reason: cancellations.get(date) ?? null }
          : null,
        projectId: project.id,
        project: { slug: project.slug, title: project.title },
      })
    }
  }

  return occurrences
}

/**
 * The meeting a project has on one campus date, cancelled or not, or null.
 *
 * What the cancel route checks against, so a lead can only call off a meeting the
 * schedule actually has.
 */
export async function meetingOn(
  project: MeetingProject,
  date: string,
): Promise<MeetingOccurrence | null> {
  const day = civilDate(date)
  const [found] = await expandMeetings(
    [project],
    campusInstant(day, 0, 0),
    campusInstant(addDays(day, 1), 0, 0),
  )
  return found ?? null
}

/** The public shape: everything a visitor may see, and none of the rest. */
export function asPublicEvent(occurrence: MeetingOccurrence) {
  const { projectId: _id, project: _project, ...rest } = occurrence
  return rest
}

/**
 * The member shape, matching what `/me/events` sends for a stored row.
 *
 * `published` is true because these are on the public calendar when the project says
 * so, and the filtering happened when the caller chose which projects to expand.
 * `createdById` is null because nobody created it: it's a rule, not a row, and a member
 * finding their own name on a meeting they never scheduled would be a lie the edit
 * buttons then act on.
 */
export function asMemberEvent(occurrence: MeetingOccurrence) {
  return {
    ...occurrence,
    published: true,
    teamId: null,
    createdById: null,
    team: null,
  }
}
