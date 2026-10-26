import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { requireOfficer } from '../../auth/authz.js'
import { type AuthEnv, originGuard, requireAuth } from '../../auth/session.js'
import {
  calendarIdOf,
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  googleCalendarStatus,
  syncGoogleCalendar,
} from '../../calendar/googleCalendar.js'
import { rateLimit } from '../../core/rateLimit.js'
import { validate } from '../../core/validate.js'

/**
 * The Google Calendar the site imports from, set on the events desk.
 *
 *   GET    /api/officer/google-calendar       -> which calendar, last sync, last error
 *   PUT    /api/officer/google-calendar       -> save an address and import from it
 *   POST   /api/officer/google-calendar/sync  -> import now
 *   DELETE /api/officer/google-calendar       -> stop importing
 *
 * The address itself is never sent back: it reads the whole calendar, private events included.
 */
export const googleCalendar = new Hono<AuthEnv>()

const writes = rateLimit('officer', 60)

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

googleCalendar.get('/', requireAuth, requireOfficer, async (c) =>
  c.json(await googleCalendarStatus()),
)

googleCalendar.put(
  '/',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate('json', z.object({ url: z.string().trim().min(1).max(1_000) })),
  async (c) => {
    const { url } = c.req.valid('json')
    if (!calendarIdOf(url)) {
      throw new HTTPException(400, {
        message:
          `Paste the calendar's "Secret address in iCal format" from its Google Calendar settings.`,
      })
    }

    let report
    try {
      report = await connectGoogleCalendar(url)
    } catch (error) {
      throw new HTTPException(400, {
        message: `Couldn't read that calendar. ${message(error)}`,
      })
    }
    return c.json({ ...(await googleCalendarStatus()), report })
  },
)

googleCalendar.post('/sync', originGuard, requireAuth, requireOfficer, writes, async (c) => {
  try {
    const report = await syncGoogleCalendar()
    return c.json({ ...(await googleCalendarStatus()), report })
  } catch (error) {
    throw new HTTPException(502, { message: `The import failed. ${message(error)}` })
  }
})

googleCalendar.delete('/', originGuard, requireAuth, requireOfficer, writes, async (c) => {
  const released = await disconnectGoogleCalendar()
  return c.json({ ...(await googleCalendarStatus()), released })
})
