import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { requireOfficer } from '../../auth/authz.js'
import { type AuthEnv, originGuard, requireAuth } from '../../auth/session.js'
import {
  GoogleCalendarError,
  addGoogleCalendar,
  changeGoogleCalendar,
  listGoogleCalendars,
  removeGoogleCalendar,
  syncGoogleCalendars,
} from '../../calendar/googleCalendar.js'
import { rateLimit } from '../../core/rateLimit.js'
import { validate } from '../../core/validate.js'

/**
 * The Google Calendars the site imports from, managed on the events desk.
 *
 *   GET    /api/officer/google-calendars        -> each calendar, its last sync and last error
 *   POST   /api/officer/google-calendars        -> add one by its address and import from it
 *   PUT    /api/officer/google-calendars/:id    -> replace its address (after a secret reset)
 *   POST   /api/officer/google-calendars/sync   -> import from all of them now
 *   DELETE /api/officer/google-calendars/:id    -> stop importing from one
 *
 * Addresses are never sent back: each reads its whole calendar, private events included. Every
 * write answers with the fresh list so the desk doesn't ask again.
 */
export const googleCalendar = new Hono<AuthEnv>()

const writes = rateLimit('officer', 60)
const address = z.object({ url: z.string().trim().min(1).max(1_000) })

/** The module's refusals carry their own status; anything else is a real failure. */
async function refusals<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof GoogleCalendarError) {
      throw new HTTPException(error.status, { message: error.message })
    }
    throw error
  }
}

googleCalendar.get('/', requireAuth, requireOfficer, async (c) =>
  c.json(await listGoogleCalendars()),
)

googleCalendar.post(
  '/sync',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  async (c) => {
    const report = await syncGoogleCalendars()
    return c.json({ calendars: await listGoogleCalendars(), report })
  },
)

googleCalendar.post(
  '/',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate('json', address),
  async (c) => {
    const report = await refusals(() => addGoogleCalendar(c.req.valid('json').url))
    return c.json({ calendars: await listGoogleCalendars(), report }, 201)
  },
)

googleCalendar.put(
  '/:id',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate('json', address),
  async (c) => {
    const report = await refusals(() =>
      changeGoogleCalendar(c.req.param('id'), c.req.valid('json').url),
    )
    return c.json({ calendars: await listGoogleCalendars(), report })
  },
)

googleCalendar.delete('/:id', originGuard, requireAuth, requireOfficer, writes, async (c) => {
  const released = await removeGoogleCalendar(c.req.param('id'))
  return c.json({ calendars: await listGoogleCalendars(), released })
})
