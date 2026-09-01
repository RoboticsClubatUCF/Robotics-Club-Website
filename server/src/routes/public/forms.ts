import { Hono, type Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { validate } from '../../core/validate.js'
import { prisma } from '../../core/db.js'
import { sendContactNotification } from '../../email/mail.js'
import { clientAddress, consume, peek, rateLimit } from '../../core/rateLimit.js'

/**
 * Public write endpoints. These are unauthenticated, so they are the only way
 * an outsider can put rows in the database — hence the length caps and the
 * shared rate limit.
 *
 * Joining the club is not one of these: that is account signup, which will
 * create a User at the default GUEST role once auth exists.
 */
export const forms = new Hono()

const limit = rateLimit('forms')

/**
 * The ceiling on top of that: two messages from one visitor a day.
 *
 * `limit` above is a *rate* — it stops a script hammering the endpoint and
 * resets ten minutes later, which is the right shape for a burst and the wrong
 * one for a mailbox. Nobody legitimately writes to a club three times in a day;
 * a bot that paces itself to one message every eleven minutes would have put a
 * hundred and thirty rows in front of the officers by morning and never tripped
 * a thing. So the two budgets stack and they are not redundant: the rate says
 * how fast, this says how many.
 *
 * Its own scope, because a scope holds one row per caller and this window is
 * twenty-four hours where `forms:` is ten minutes. Sharing the name would mean
 * whichever endpoint was hit first set the expiry for both.
 */
const CONTACT_PER_DAY = 2
const CONTACT_WINDOW_SECONDS = 86_400

/**
 * Built from `clientAddress` rather than the middleware, because this one
 * window is spent by the POST and read by the GET below and both have to land
 * on the same row.
 */
const dayKey = (c: Context) => `contact-day:${clientAddress(c)}`

const OUT_OF_MESSAGES =
  "You've already sent us two messages today — that's the daily limit. An officer will reply to those; anything else can wait until tomorrow."

/**
 * Can this visitor still write to us? Asked before the form is drawn.
 *
 * The form is the only unauthenticated write on the site, and a box that
 * accepts a message it is about to be refused wastes whatever somebody just
 * typed. So the page asks first and renders the refusal instead of the fields.
 *
 * **This is politeness, not the boundary.** Anything that ignores the answer —
 * a script that reloads the page and posts straight at the endpoint, which is
 * exactly what a bot does — is refused by the `consume` in the POST below,
 * which is the same window seen from the other side. Nothing here is load-
 * bearing; deleting it would cost the sender a wasted message and nothing else.
 *
 * `peek` rather than `consume`: a check that spent the budget would be a
 * denial-of-service on the visitor by the page they came to read.
 *
 * `no-store` because the answer is per-caller. `forms` mounts ahead of
 * `publicApi` in `app.ts`, so nothing stamps a shared-cache header on it today
 * — but this is a GET under `/api`, and one registration-order mistake away
 * from a CDN handing one visitor's remaining messages to everybody.
 */
forms.get('/contact', async (c) => {
  c.header('Cache-Control', 'no-store')

  const { allowed, used, retryAfter } = await peek(dayKey(c), CONTACT_PER_DAY)

  return c.json({
    allowed,
    remaining: Math.max(0, CONTACT_PER_DAY - used),
    // Seconds until the window closes, so the page can say when rather than
    // just no. Zero when nothing has been sent — there is no window open yet.
    retryAfter,
    message: allowed ? null : OUT_OF_MESSAGES,
  })
})

const contactSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().max(200),
  subject: z.string().trim().max(200).optional(),
  message: z.string().trim().min(1).max(5000),
})

forms.post(
  '/contact',
  limit,
  validate('json', contactSchema),
  async (c) => {
    const contact = c.req.valid('json')

    /**
     * Spent here rather than as middleware, and the position is the whole
     * difference between a budget of two *messages* and a budget of two
     * *attempts*. Middleware runs ahead of `zValidator`, so a mistyped address
     * would burn a day's allowance on a message that was never sent — and the
     * sender, having been told to check the fields, would fix them and be
     * refused. `limit` above is deliberately the other way round: counting
     * malformed bodies is exactly what a burst limit is for.
     *
     * Before the write, so a refusal leaves no row. The window is only extended
     * when it had already closed, so a bot that keeps knocking runs the count
     * up without ever pushing back its own reprieve.
     */
    const day = await consume(dayKey(c), CONTACT_PER_DAY, CONTACT_WINDOW_SECONDS)

    if (!day.allowed) {
      c.header('Retry-After', String(day.retryAfter))
      throw new HTTPException(429, { message: OUT_OF_MESSAGES })
    }

    const { id } = await prisma.contactMessage.create({
      data: contact,
      select: { id: true },
    })

    // Notify after the write and never instead of it. The row is the record: a
    // message that was stored and then failed to send must still be there for
    // someone to find, and the sender must not be told it failed once it is
    // safely in the table.
    //
    // Deliberately not awaited. Postmark is a network call to somebody else's
    // service, and the sender should not wait on it — or see an error because
    // of it. An unhandled rejection would take the process down, hence the
    // explicit catch; the log is the thing to grep when a reply never arrives.
    void sendContactNotification({ id, ...contact }).catch((error: unknown) => {
      console.error(`contact ${id}: notification failed`, error)
    })

    // `remaining` so the form can take itself down after the last one rather
    // than offering a box the next submit would refuse. It is the same number
    // the GET above reports, from the other side of the same window.
    return c.json({ id, status: 'received', remaining: day.remaining }, 201)
  },
)
