import type { ApiManagedProject } from './api'

/** Indexed by `Date.getDay()`, which is also how `meetingWeekday` is stored. */
export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
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
 * The sentence a project's schedule prints everywhere it appears, or null when
 * the lead has not set one — the caller says nothing rather than "Meets
 * undefined", per the site's rule against invented content.
 */
export function meetingLine(project: ApiManagedProject): string | null {
  if (project.meetingWeekday === null || !project.meetingTime) return null

  const line = `Meets ${WEEKDAY_NAMES[project.meetingWeekday]}s · ${formatMeetingTime(project.meetingTime)}`
  return project.meetingLocation ? `${line} · ${project.meetingLocation}` : line
}
