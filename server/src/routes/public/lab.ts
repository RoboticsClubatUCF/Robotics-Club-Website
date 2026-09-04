import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { validate } from '../../core/validate.js'
import { requireOfficer } from '../../auth/authz.js'
import {
  BUILDING_HOURS_SENTENCE,
  buildingOpen,
  cooldownSentence,
  flipLabStatus,
  readLabStatus,
} from '../../lab/labStatus.js'
import { rateLimit } from '../../core/rateLimit.js'
import { type AuthEnv, originGuard, requireAuth } from '../../auth/session.js'

/**
 * Is the lab open.
 *
 *   GET   /api/lab  -> anybody
 *   PATCH /api/lab  -> an officer says so, if the building is open
 *
 * Both halves in one file rather than the read in `content.ts` and the write in
 * `officer.ts`. They answer with the same two fields and the whole feature is those two
 * fields, so splitting them across two thousand-line routers would be two places to keep
 * one shape in step. What the row means, and why the write goes to Discord before the
 * database, is `src/lab/labStatus.ts`.
 *
 * This is no longer the only way the lab gets flipped: the sign in Discord carries a
 * button, and a press arrives at `routes/webhooks/discordInteractions.ts` instead. Both
 * end up in the same `flipLabStatus`.
 *
 * Neither half returns who flipped it. The database records it and the club's Discord
 * channel says it out loud, because that's the room where the question gets asked. Putting
 * an officer's name on a public endpoint publishes which named person was in a particular
 * building at a particular hour, to anybody who asks, for ever.
 */
export const lab = new Hono<AuthEnv>()

/**
 * Its own scope and a small budget, and the budget is really Discord's rather than ours.
 * Every write is a message edit and a channel rename against somebody else's API, and the
 * channel name is limited to two changes per ten minutes. Ten presses in a window is far
 * more than anybody flipping a light switch needs.
 */
const flips = rateLimit('lab', 10)

/**
 * Public, and mounted outside the cached half of the API on purpose.
 *
 * Everything in `content.ts` carries `s-maxage=300`, which is right for a list of officers
 * and wrong for this: a five-minute-old answer to "is the lab open right now" is exactly
 * the answer that sends somebody across campus for nothing.
 */
lab.get('/', async (c) => {
  const state = await readLabStatus()

  c.header('Cache-Control', 'public, max-age=30, s-maxage=30')

  return c.json({
    open: state.open,
    changedAt: state.changedAt,
    // Sent rather than worked out in the browser, and that's the one decision in this
    // feature that went against the site's usual mirror pattern. `lib/dues/dues.ts` mirrors
    // a server rule so a form doesn't offer what the route will reject; here the rule is a
    // question about the clock — in Orlando, not the reader's zone — that the server answers
    // on every read anyway.
    buildingOpen: state.buildingOpen,
  })
})

lab.patch(
  '/',
  originGuard,
  requireAuth,
  requireOfficer,
  flips,
  validate('json', z.object({ open: z.boolean() })),
  async (c) => {
    const { open } = c.req.valid('json')
    const user = c.get('user')

    /**
     * The one refusal that isn't about who is asking.
     *
     * 409 rather than 403: nothing is wrong with this officer, the world is simply in a
     * state where the request doesn't make sense. Closing is always allowed, because an
     * officer realising at 22:05 that they left it open is exactly the person this
     * shouldn't argue with.
     */
    if (open && !buildingOpen(new Date())) {
      throw new HTTPException(409, { message: BUILDING_HOURS_SENTENCE })
    }

    /**
     * Awaited, and that's the change this endpoint is really about.
     *
     * It used to write the row and fire the Discord push off behind it, so an officer never
     * waited on somebody else's API. The cost was a throttled rename leaving the site saying
     * OPEN over a channel still reading closed — and people read the channel. Discord is the
     * record now, so a flip it won't take hasn't happened, and the officer is told which of
     * the two it was.
     *
     * The wait is two Discord calls behind a five-second deadline each, and `flipLabStatus`
     * serialises them, so the worst case is bounded and rare.
     */
    const flip = await flipLabStatus(open, user)

    if (flip.status === 'cooldown') {
      // 429 with the wait on it, the same shape the rate limiter answers with, so the
      // browser and any script see one convention for "not now".
      c.header('Retry-After', String(Math.ceil(flip.retryAfterMs / 1_000)))
      throw new HTTPException(429, { message: cooldownSentence(flip.retryAfterMs) })
    }

    if (flip.status === 'refused') {
      // 502 rather than 500: nothing here failed. Discord refused the rename or couldn't be
      // reached, and the sentence says so, because "try again" against a missing Manage
      // Channels is advice that never comes good.
      console.error(`lab status: flip refused by Discord — ${flip.reason}`)
      throw new HTTPException(502, {
        message:
          "Discord wouldn't let the lab channel be renamed, so the lab has been left as it was. Check the bot still has Manage Channels on that channel.",
      })
    }

    return c.json({
      open: flip.state.open,
      changedAt: flip.state.changedAt,
      buildingOpen: flip.state.buildingOpen,
    })
  },
)
