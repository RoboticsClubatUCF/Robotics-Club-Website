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
 * "6:00 – 10:00 PM", dropping the meridiem from the first half when both are
 * in the same one.
 *
 * "6:00 PM – 10:00 PM" is what the naive version prints and it reads as two
 * separate facts rather than one span. Losing the repeat is what makes a range
 * scan as a range.
 */
export function formatMeetingRange(start: string, end: string): string {
  const from = formatMeetingTime(start)
  const to = formatMeetingTime(end)
  const sameHalf = from.slice(-2) === to.slice(-2)

  return `${sameHalf ? from.slice(0, -3) : from} – ${to}`
}

/**
 * "Tuesdays and Thursdays". Plural, because a weekly meeting is a habit rather
 * than a date, and that is how somebody would say it out loud.
 *
 * "and" rather than a trailing comma at the join: a list of at most seven
 * weekdays never needs the Oxford comma to be unambiguous, and "Mondays,
 * Wednesdays, and Fridays" is a sentence about a schedule where "Mondays,
 * Wednesdays and Fridays" is a schedule.
 */
export function formatWeekdays(days: number[]): string {
  const names = days
    .filter((day) => day >= 0 && day <= 6)
    .map((day) => `${WEEKDAY_NAMES[day]}s`)

  if (names.length === 0) return ''
  if (names.length === 1) return names[0]!
  if (names.length === 7) return 'every day'

  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!}`
}

/** Everything a project needs to have said before it has a schedule at all. */
type Scheduled = Pick<
  ApiManagedProject,
  'meetingWeekdays' | 'meetingStartTime' | 'meetingEndTime'
>

/**
 * Whether this project meets at all.
 *
 * Days and times stand or fall together — the server enforces it, and this is
 * the browser reading the same rule rather than a second opinion. See
 * `server/src/projects/projectMeeting.ts`.
 */
export function hasSchedule(project: Scheduled): boolean {
  return (
    project.meetingWeekdays.length > 0 &&
    Boolean(project.meetingStartTime) &&
    Boolean(project.meetingEndTime)
  )
}

/**
 * The sentence a project's schedule prints everywhere it appears, or null when
 * the lead has not set one — the caller says nothing rather than "Meets
 * undefined", per the site's rule against invented content.
 */
export function meetingLine(
  project: Scheduled & Pick<ApiManagedProject, 'meetingLocation'>,
): string | null {
  if (!hasSchedule(project)) return null

  const line = `Meets ${formatWeekdays(project.meetingWeekdays)} · ${formatMeetingRange(
    project.meetingStartTime!,
    project.meetingEndTime!,
  )}`

  return project.meetingLocation ? `${line} · ${project.meetingLocation}` : line
}
