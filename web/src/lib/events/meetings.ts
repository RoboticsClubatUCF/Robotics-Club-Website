import type { ApiManagedProject } from '../api/api'

/** Indexed by `Date.getDay()`, which is also how `meetingWeekdays` is stored. */
export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

/** The three-letter forms, for a checkbox row that has to fit on a phone. */
export const WEEKDAY_SHORT = [
  'SUN',
  'MON',
  'TUE',
  'WED',
  'THU',
  'FRI',
  'SAT',
] as const

/** Weeks of the month as stored, -1 being the last, and what each is called. */
export const MONTH_WEEKS = [
  [1, 'first'],
  [2, 'second'],
  [3, 'third'],
  [4, 'fourth'],
  [-1, 'last'],
] as const

/**
 * "18:30" -> "6:30 PM". The server validated the shape, so this is string
 * maths on trusted input — no Date object, because a wall-clock time is not a
 * moment and turning it into one is how DST bugs start.
 */
export function formatMeetingTime(time: string): string {
  const [hourPart = '0', minutePart = '00'] = time.split(':')
  const hour = Number(hourPart)

  return `${((hour + 11) % 12) + 1}:${minutePart} ${hour < 12 ? 'AM' : 'PM'}`
}

/**
 * "6:00 – 10:00 PM", dropping the meridiem from the first half when both are in the same one.
 *
 * "6:00 PM – 10:00 PM" is what the naive version prints and it reads as two separate facts rather
 * than one span. Losing the repeat is what makes a range scan as a range.
 */
export function formatMeetingRange(start: string, end: string): string {
  const from = formatMeetingTime(start)
  const to = formatMeetingTime(end)
  const sameHalf = from.slice(-2) === to.slice(-2)

  return `${sameHalf ? from.slice(0, -3) : from} – ${to}`
}

/**
 * "a, b and c". "and" rather than a trailing comma at the join: "Mondays, Wednesdays, and
 * Fridays" is a sentence about a schedule where "Mondays, Wednesdays and Fridays" is a schedule.
 */
function listed(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!}`
}

const dayNames = (days: number[]) =>
  days.filter((day) => day >= 0 && day <= 6).map((day) => WEEKDAY_NAMES[day])

/**
 * "Tuesdays and Thursdays". Plural, because a weekly meeting is a habit rather than a date, and
 * that is how somebody would say it out loud.
 */
export function formatWeekdays(days: number[]): string {
  const names = dayNames(days)
  if (names.length === 7) return 'every day'
  return listed(names.map((name) => `${name}s`))
}

/** "1st", "12th", "23rd". */
export function ordinal(n: number): string {
  if (n >= 11 && n <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

/** "1st and last day", for the days of the month. */
export function formatMonthDays(days: number[]): string {
  const numbered = days.filter((day) => day > 0).map(ordinal)
  if (days.includes(-1)) return `${listed([...numbered, 'last'])} day`
  return listed(numbered)
}

/**
 * A campus date, "2026-09-23", as "Sep 23" in the reader's own words.
 *
 * Built from its parts rather than parsed: `new Date('2026-09-23')` is midnight UTC, which is
 * the evening before for everybody in Florida.
 */
export function formatCivilDate(
  date: string,
  options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' },
): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString(undefined, options)
}

/** Today as a campus-style date string, in the reader's zone, which on campus is the same. */
export function todayCivil(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** Everything a project needs to have said before it has a schedule at all. */
type Scheduled = Pick<
  ApiManagedProject,
  | 'meetingRepeat'
  | 'meetingWeekdays'
  | 'meetingInterval'
  | 'meetingMonthWeeks'
  | 'meetingMonthDays'
  | 'meetingDates'
  | 'meetingStartsOn'
  | 'meetingStartTime'
  | 'meetingEndTime'
>

/**
 * Whether this project meets at all.
 *
 * A pattern and both times, the server's rule read rather than second-guessed. See
 * `server/src/projects/projectMeeting.ts`.
 */
export function hasSchedule(project: Scheduled): boolean {
  return (
    project.meetingRepeat !== null &&
    Boolean(project.meetingStartTime) &&
    Boolean(project.meetingEndTime)
  )
}

/**
 * When the pattern lands, as somebody would say it: "Tuesdays and Thursdays", "every other
 * Wednesday", "the first Saturday of the month", "Sep 23, Oct 7 and 2 more dates".
 *
 * A list of dates names the ones still ahead, since the past ones are no use to anybody reading
 * it. Null when there's nothing to say: no pattern, a pattern not filled in yet (a form mid-edit
 * reads through here too), or no dates left.
 */
export function meetingPattern(
  project: Scheduled,
  now: Date = new Date(),
): string | null {
  const today = todayCivil(now)
  const from =
    project.meetingStartsOn && project.meetingStartsOn > today
      ? ` from ${formatCivilDate(project.meetingStartsOn)}`
      : ''

  switch (project.meetingRepeat) {
    case null:
      return null

    case 'WEEKLY': {
      if (project.meetingWeekdays.length === 0) return null
      const interval = project.meetingInterval
      if (interval <= 1) return `${formatWeekdays(project.meetingWeekdays)}${from}`

      const names = dayNames(project.meetingWeekdays)
      return interval === 2
        ? `every other ${listed(names)}${from}`
        : `every ${String(interval)} weeks on ${formatWeekdays(project.meetingWeekdays)}${from}`
    }

    case 'MONTHLY_WEEKDAY': {
      if (project.meetingWeekdays.length === 0) return null
      const weeks = MONTH_WEEKS.filter(([week]) =>
        project.meetingMonthWeeks.includes(week),
      ).map(([, name]) => name)
      if (weeks.length === 0) return null
      return `the ${listed(weeks)} ${listed(dayNames(project.meetingWeekdays))} of the month${from}`
    }

    case 'MONTHLY_DAY':
      if (project.meetingMonthDays.length === 0) return null
      return `on the ${formatMonthDays(project.meetingMonthDays)} of the month${from}`

    case 'DATES': {
      const ahead = project.meetingDates.filter((date) => date >= today)
      if (ahead.length === 0) return null

      const named = ahead.slice(0, 3).map((date) => formatCivilDate(date))
      const rest = ahead.length - named.length
      return rest > 0
        ? `${named.join(', ')} and ${String(rest)} more ${rest === 1 ? 'date' : 'dates'}`
        : listed(named)
    }
  }
}

/**
 * The sentence a project's schedule prints everywhere it appears, or null when
 * the lead has not set one — the caller says nothing rather than "Meets
 * undefined", per the site's rule against invented content.
 */
export function meetingLine(
  project: Scheduled & Pick<ApiManagedProject, 'meetingLocation'>,
  now: Date = new Date(),
): string | null {
  if (!hasSchedule(project)) return null

  const pattern = meetingPattern(project, now)
  if (!pattern) return null

  const line = `Meets ${pattern} · ${formatMeetingRange(
    project.meetingStartTime!,
    project.meetingEndTime!,
  )}`

  return project.meetingLocation ? `${line} · ${project.meetingLocation}` : line
}

/**
 * The lead's note about the meeting, or null.
 *
 * Gated on there being a schedule for the same reason `meetingLine` is: a note about when a project
 * meets makes no sense under a project that does not. The server clears the two together, so this
 * only speaks to a row cleared straight in the database.
 */
export function meetingNote(
  project: Scheduled & Pick<ApiManagedProject, 'meetingDescription'>,
): string | null {
  if (!hasSchedule(project)) return null
  return project.meetingDescription?.trim() || null
}
