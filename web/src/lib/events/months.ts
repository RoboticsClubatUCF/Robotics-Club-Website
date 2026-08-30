/**
 * Month arithmetic, shared by the calendar and the two pages that drive it.
 *
 * Its own file rather than exports beside `MonthCalendar`, for the reason
 * `lib/auth/session.ts` sits apart from `lib/auth/auth.tsx`: a module that exports both
 * a component and plain values loses Fast Refresh, and the whole calendar
 * re-mounting on every edit is a poor way to work on a calendar.
 *
 * Local time throughout. A month is a thing on a wall, not an instant.
 */

export const startOfMonth = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), 1)

export const addMonths = (date: Date, count: number) =>
  new Date(date.getFullYear(), date.getMonth() + count, 1)
