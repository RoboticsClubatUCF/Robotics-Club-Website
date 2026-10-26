import { type Context, Hono, type MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { type AuthEnv, originGuard, requireAuth } from '../auth/session.js'
import { validate } from '../core/validate.js'
import {
  type CalendarScope,
  GoogleCalendarError,
  addGoogleCalendar,
  changeGoogleCalendar,
  listGoogleCalendars,
  removeGoogleCalendar,
  setGoogleCalendarPublished,
  syncScope,
} from './googleCalendar.js'

/**
 * One set of Google Calendar routes, mounted twice: for the club's calendars on the events desk
 * (`routes/officer/googleCalendar.ts`) and for one project's on its manage page
 * (`routes/projects/projectCalendars.ts`). The mount decides who may call it and which calendars it
 * reaches; everything below is the same.
 *
 *   GET    /           -> the calendars, each with its last sync and last error
 *   POST   /           -> add one by its address and import from it
 *   POST   /sync       -> import from all of them now
 *   PUT    /:id        -> replace its address (after a secret reset)
 *   PATCH  /:id        -> public or not (project calendars only)
 *   DELETE /:id        -> stop importing from it
 *
 * Addresses are never sent back: each reads its whole calendar, private events included. Every
 * write answers with the fresh list so the page doesn't ask again.
 */
export function calendarRoutes({
  authorize,
  scopeOf,
  writes,
}: {
  /** Runs after sign-in on every route; refuses whoever may not manage these calendars. */
  authorize: MiddlewareHandler<AuthEnv>
  scopeOf: (c: Context<AuthEnv>) => CalendarScope
  writes: MiddlewareHandler<AuthEnv>
}) {
  const router = new Hono<AuthEnv>()
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

  const list = (c: Context<AuthEnv>) => listGoogleCalendars(scopeOf(c))

  router.get('/', requireAuth, authorize, async (c) => c.json(await list(c)))

  router.post('/sync', originGuard, requireAuth, authorize, writes, async (c) => {
    const report = await syncScope(scopeOf(c))
    return c.json({ calendars: await list(c), report })
  })

  router.post(
    '/',
    originGuard,
    requireAuth,
    authorize,
    writes,
    validate('json', address.extend({ published: z.boolean().default(true) })),
    async (c) => {
      const { url, published } = c.req.valid('json')
      const report = await refusals(() => addGoogleCalendar(url, scopeOf(c), published))
      return c.json({ calendars: await list(c), report }, 201)
    },
  )

  router.put(
    '/:id',
    originGuard,
    requireAuth,
    authorize,
    writes,
    validate('json', address),
    async (c) => {
      const report = await refusals(() =>
        changeGoogleCalendar(c.req.param('id'), c.req.valid('json').url, scopeOf(c)),
      )
      return c.json({ calendars: await list(c), report })
    },
  )

  router.patch(
    '/:id',
    originGuard,
    requireAuth,
    authorize,
    writes,
    validate('json', z.object({ published: z.boolean() })),
    async (c) => {
      await refusals(() =>
        setGoogleCalendarPublished(c.req.param('id'), scopeOf(c), c.req.valid('json').published),
      )
      return c.json({ calendars: await list(c) })
    },
  )

  router.delete('/:id', originGuard, requireAuth, authorize, writes, async (c) => {
    const released = await refusals(() => removeGoogleCalendar(c.req.param('id'), scopeOf(c)))
    return c.json({ calendars: await list(c), released })
  })

  return router
}
