import { requireOfficer } from '../../auth/authz.js'
import { calendarRoutes } from '../../calendar/calendarRoutes.js'
import { rateLimit } from '../../core/rateLimit.js'

/**
 * The club's Google Calendars, at `/api/officer/google-calendars`, managed on the events desk.
 * Officers only; their events are always public. The routes are `calendar/calendarRoutes.ts`.
 */
export const googleCalendar = calendarRoutes({
  authorize: requireOfficer,
  scopeOf: () => ({ projectId: null }),
  writes: rateLimit('officer', 60),
})
