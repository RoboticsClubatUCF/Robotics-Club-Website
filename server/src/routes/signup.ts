import { createHash, randomBytes } from 'node:crypto'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { prisma } from '../db.js'
import {
  checkDiscordHandle,
  isHandleShaped,
  normaliseHandle,
} from '../discord.js'
import { env } from '../env.js'
import { sendSignupVerification } from '../mail.js'
import { hashPassword } from '../password.js'
import { rateLimit } from '../rateLimit.js'

/**
 * Signup: joining the club is creating an account.
 *
 * It is two requests with an email in between, and the shape is the point. The
 * first says an address and gets a link; the second arrives with that link's
 * token and everything else. Nothing about the person is stored until the
 * address is proved, so a bot working through a list of addresses leaves rows
 * in `signup_verifications` that expire on their own — never half-built users
 * somebody has to sort out by hand.
 *
 *   POST /api/signup/start          { email, acknowledged } -> 202
 *   POST /api/signup/verify         { token }               -> 200 { email }
 *   POST /api/signup/discord-check  { discordUsername }     -> 200 { status }
 *   POST /api/signup/complete       { token, ... }          -> 201 { id }
 *
 * These are unauthenticated — there is no session to have yet — so, like the
 * contact form, every field is capped and every route is rate limited.
 *
 * The account lands at the default GUEST role with no slug, which is what keeps
 * it off the public roster: signing up is not membership, and an officer
 * promotes from there. Nothing signs in yet; the password is taken now because
 * asking everyone to come back and set one later is how you end up with a
 * roster of accounts nobody can get into.
 */
export const signup = new Hono()

/**
 * Two budgets, because two different things are being limited.
 *
 * `writes` covers the requests that cost something — an email sent to a real
 * inbox, an account created — and shares the site's default allowance of five.
 * `checks` covers the ones a form makes on the visitor's behalf while they are
 * still filling it in: the Discord field re-checks itself as a typo is
 * corrected, and following a link from a mail app that prefetches can verify
 * more than once. Five of those is a limit that bites the people it is meant to
 * serve.
 */
const writes = rateLimit('signup')
const checks = rateLimit('signup-check', 30)

/**
 * Membership is for current UCF students, and this is the line the whole first
 * step exists to draw. `@knights.ucf.edu` is UCF's old student domain and is
 * deliberately not accepted: the address has to be one the club can still reach
 * someone at, and knights addresses stop resolving after graduation.
 */
const STUDENT_DOMAIN = '@ucf.edu'

const studentEmail = z
  .string()
  // Trimmed and lowercased before validation, not after: a pasted address
  // carries a trailing space often enough to matter, and `z.email()` would
  // reject it on the space rather than say anything useful. Lowercase is what
  // makes the unique constraint on `User.email` mean one address rather than
  // one spelling of it.
  .trim()
  .toLowerCase()
  .pipe(z.email().max(200))
  .refine((email) => email.endsWith(STUDENT_DOMAIN), {
    message: `Use your UCF student email — it has to end in ${STUDENT_DOMAIN}.`,
  })

const startSchema = z.object({
  email: studentEmail,
  /**
   * The "I understand" box, checked on the server as well as in the form.
   * `z.literal(true)` and not `boolean()`: the disclaimer is the one thing this
   * step is for, and a checkbox is only a promise the browser makes.
   */
  acknowledged: z.literal(true),
})

const tokenSchema = z.object({ token: z.string().min(1).max(200) })

const handleSchema = z.object({
  discordUsername: z.string().trim().min(1).max(64),
})

const completeSchema = z.object({
  token: z.string().min(1).max(200),
  // Split rather than one "full name" field so the club can address people by
  // their first name in mail. They are stored joined, in `User.fullName`, which
  // is the column the roster and every listing already read.
  firstName: z.string().trim().min(1).max(50),
  lastName: z.string().trim().min(1).max(50),
  /**
   * Long, and nothing else. Composition rules push people toward `Password1!`
   * and are no longer advised by anyone who has measured them; length is the
   * part that helps. The cap is not a policy — scrypt is deliberately expensive
   * and an unbounded input is a way to make the server do arbitrary work.
   */
  password: z.string().min(10).max(200),
  discordUsername: z.string().trim().min(1).max(64),
  /**
   * The member acknowledgement — safety, equipment, conduct, dues.
   *
   * `z.literal(true)` for the same reason `/start` uses it: a checkbox is a
   * promise the browser makes, and posting straight at this endpoint must not
   * be a way past reading the thing. Separate from that first box on purpose —
   * one says who may join, this one is what they are agreeing to.
   *
   * When it was accepted is written to the account, because an agreement the
   * club cannot produce afterwards has not done the job it was collected for.
   */
  acknowledgementAccepted: z.literal(true),
})

/** The token is a credential, so only its hash is ever compared or stored. */
const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex')

/**
 * Find the pending signup a token belongs to, or refuse.
 *
 * Expired, unknown and already-used all come back as one 410 with one sentence.
 * They are the same thing from where the visitor is standing — the link doesn't
 * work, ask for another — and telling them apart would confirm to anyone
 * guessing which tokens exist.
 */
async function requirePending(token: string) {
  const pending = await prisma.signupVerification.findUnique({
    where: { tokenHash: hashToken(token) },
  })

  if (!pending || pending.expiresAt <= new Date()) {
    throw new HTTPException(410, {
      message:
        'That link has expired or has already been used. Start again and we will send you a new one.',
    })
  }

  return pending
}

/**
 * Which unique constraint a write tripped, if it tripped one.
 *
 * Duck-typed on the error code rather than caught by class: Prisma's error
 * classes move between packages across major versions, and this reads the same
 * either way.
 *
 * Where the offending column is named, though, does move. Prisma 6 put it in
 * `meta.target`; Prisma 7 goes through a driver adapter and the field names
 * arrive under `meta.driverAdapterError.cause`, in database spelling
 * (`discord_username`, not `discordUsername`). All three places are searched,
 * the Postgres message included, because the alternative when this stops
 * matching is a 500 on a case the route already knows how to answer — and
 * nothing fails loudly enough to notice.
 *
 * Two columns now spell 'discord' — the handle and the account id — and both
 * landing on the same answer is deliberate. A snowflake already on file under
 * some other handle is the same situation from the visitor's side: that Discord
 * account is connected to an account here already.
 */
function uniqueConflict(error: unknown): 'email' | 'discord' | null {
  if (typeof error !== 'object' || error === null) return null

  const { code, meta } = error as {
    code?: unknown
    meta?: {
      target?: unknown
      driverAdapterError?: {
        cause?: { constraint?: { fields?: unknown }; originalMessage?: unknown }
      }
    }
  }

  if (code !== 'P2002') return null

  const cause = meta?.driverAdapterError?.cause
  const named = [meta?.target, cause?.constraint?.fields, cause?.originalMessage]
    .flat()
    .filter((part) => typeof part === 'string')
    .join(' ')
    .toLowerCase()

  if (named.includes('discord')) return 'discord'
  if (named.includes('email')) return 'email'
  return null
}

const EMAIL_TAKEN =
  'There is already an account for that email. If it is yours, an officer can help you get back into it.'

const DISCORD_TAKEN =
  'That Discord username is already connected to another account.'

// ------------------------------------------------------------------- start

signup.post('/start', writes, zValidator('json', startSchema), async (c) => {
  const { email } = c.req.valid('json')

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  })

  if (existing) {
    throw new HTTPException(409, { message: EMAIL_TAKEN })
  }

  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(
    Date.now() + env.SIGNUP_TOKEN_TTL_MINUTES * 60_000,
  )
  const tokenHash = hashToken(token)

  // Upsert, so asking again replaces the pending signup instead of leaving two
  // live links for one address. `verifiedAt` resets with it: a fresh link means
  // the old one is void, including one that had already been followed.
  await prisma.signupVerification.upsert({
    where: { email },
    update: { tokenHash, expiresAt, verifiedAt: null },
    create: { email, tokenHash, expiresAt },
  })

  // Awaited, unlike the contact notification. There the email is a courtesy on
  // top of a stored row; here it is the only way the signup can continue, so
  // "sent" has to be something this route actually knows rather than assumes.
  let sent: boolean

  try {
    sent = await sendSignupVerification(email, token)
  } catch (error) {
    console.error(`signup ${email}: verification email failed`, error)
    throw new HTTPException(502, {
      message:
        'We could not send the confirmation email just now. Try again in a minute.',
    })
  }

  if (!sent) {
    if (env.NODE_ENV === 'production') {
      // Nothing the visitor did wrong, and nothing they can do about it. Say so
      // plainly rather than showing them a link that will never arrive.
      console.error(
        'signup: POSTMARK_TOKEN is not configured — no verification email can be sent',
      )
      throw new HTTPException(503, {
        message:
          'Signups are temporarily unavailable. Please try again later, or contact an officer.',
      })
    }

    // Development without a Postmark account, which is the normal state of a
    // checkout. The link goes to the log so the flow can be walked end to end;
    // it is never put in the response, because a token the caller is handed is
    // a token that proves nothing about the address it was meant for.
    console.log(
      `signup ${email}: no mailer configured — verification link is ${env.signupVerifyUrl}?token=${encodeURIComponent(token)}`,
    )
  }

  // 202: the address is on record and the link is out, but nobody has an
  // account yet and won't until the second request. The expiry goes back so the
  // page can say how long they have without hardcoding a number that lives in
  // this server's configuration.
  return c.json(
    {
      status: 'sent',
      email,
      expiresInMinutes: env.SIGNUP_TOKEN_TTL_MINUTES,
    },
    202,
  )
})

// ------------------------------------------------------------------ verify

signup.post('/verify', checks, zValidator('json', tokenSchema), async (c) => {
  const pending = await requirePending(c.req.valid('json').token)

  // Only the first time. Re-following a link — a mail app that prefetches, a
  // reload of the finish page — must not keep moving the timestamp, or it stops
  // recording when the address was actually proved.
  if (!pending.verifiedAt) {
    await prisma.signupVerification.update({
      where: { id: pending.id },
      data: { verifiedAt: new Date() },
    })
  }

  // The address comes back so the finish page can show whose account is being
  // set up. Someone who has three UCF addresses forwarded into one inbox needs
  // to see which one this is.
  return c.json({ email: pending.email })
})

// ----------------------------------------------------------- discord-check

/**
 * Is this handle a real account in the club's Discord, and is it free?
 *
 * Its own endpoint because the field asks while it is being filled in, and
 * because the two answers it gives are worth separating: "we cannot find you"
 * sends someone to the QR code on the same card, "already connected" does not.
 * Nothing here writes, and the answer is not trusted at `complete` — that
 * asks again.
 */
signup.post(
  '/discord-check',
  checks,
  zValidator('json', handleSchema),
  async (c) => {
    const handle = normaliseHandle(c.req.valid('json').discordUsername)

    if (!isHandleShaped(handle)) {
      // A display name — capitals, spaces, punctuation Discord does not allow —
      // is the usual reason to land here, and it is not a real handle, so it
      // gets the same answer as one that does not exist. A complaint about
      // which characters are legal would not tell anyone what to type instead;
      // the screenshot beside the field does.
      return c.json({ status: 'not_found' })
    }

    const taken = await prisma.user.findUnique({
      where: { discordUsername: handle },
      select: { id: true },
    })

    if (taken) return c.json({ status: 'taken' })

    return c.json(await checkDiscordHandle(handle))
  },
)

// ---------------------------------------------------------------- complete

signup.post(
  '/complete',
  writes,
  zValidator('json', completeSchema),
  async (c) => {
    const { token, firstName, lastName, password, discordUsername } =
      c.req.valid('json')
    // Read now rather than at the write below: this is the moment the agreement
    // was made, and the scrypt hash between here and there takes long enough to
    // be worth not folding into the timestamp.
    const acknowledgementAcceptedAt = new Date()

    const pending = await requirePending(token)
    const handle = normaliseHandle(discordUsername)

    // Asked again, from here. The field already checked itself, but that answer
    // went to a browser and came back, and this is the value the club's tooling
    // will join on for the next several years.
    const check = isHandleShaped(handle)
      ? await checkDiscordHandle(handle)
      : ({ status: 'not_found' } as const)

    if (check.status === 'not_found') {
      throw new HTTPException(422, { message: 'Cannot find that user.' })
    }

    if (check.status === 'unavailable') {
      // Discord is down or the bot is misconfigured. Refusing costs someone a
      // few minutes; accepting writes an unconfirmed handle that looks exactly
      // like a confirmed one from then on.
      throw new HTTPException(503, {
        message:
          'We could not reach Discord to confirm that username. Try again in a minute.',
      })
    }

    // `connected` gives Discord's own spelling back; `unchecked` means no bot is
    // configured and the handle stands as the visitor typed it.
    const confirmedHandle =
      check.status === 'connected' ? check.username : handle

    // The account's snowflake, when Discord was actually asked. This is the
    // half that survives somebody changing their username, and it is what the
    // bot addresses a direct message to — without it, every message costs a
    // guild search first. Null when no bot is configured, which is the same
    // state every row created before the check existed is in.
    const confirmedId = check.status === 'connected' ? check.id : null

    const passwordHash = await hashPassword(password)

    try {
      const { id } = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            // Stored joined because `fullName` is the column the roster, the
            // officer cards and every listing already read. Splitting that in
            // two is a schema change and a migration for every one of them.
            fullName: `${firstName} ${lastName}`,
            email: pending.email,
            passwordHash,
            discordUsername: confirmedHandle,
            discordId: confirmedId,
            acknowledgementAcceptedAt,
            // No slug and the default GUEST role: a signup is not a roster
            // entry. `joinedAt` stays null too — that is the date someone
            // became a member, which is a decision an officer makes later;
            // `createdAt` already records the signup itself.
          },
          select: { id: true },
        })

        // In the same transaction as the account. Spending the link separately
        // could leave it live beside a created account, or spend it against an
        // account that failed to write.
        await tx.signupVerification.delete({ where: { id: pending.id } })

        return created
      })

      // Deliberately thin. Nothing about the account goes back over the wire —
      // there is no session to establish yet, and the email and password hash
      // are exactly what the public routes are careful never to return.
      return c.json({ id, status: 'created' }, 201)
    } catch (error) {
      // Both of these are already checked above, so reaching one means two
      // signups raced — or that somebody used the same address twice between
      // the check and the write. The constraint is what actually decides it.
      const conflict = uniqueConflict(error)

      if (conflict === 'email') {
        throw new HTTPException(409, { message: EMAIL_TAKEN })
      }

      if (conflict === 'discord') {
        throw new HTTPException(409, { message: DISCORD_TAKEN })
      }

      throw error
    }
  },
)

/**
 * Drop verifications that have already expired.
 *
 * Same reasoning as the rate-limit sweep, and it runs on the same timer: these
 * rows hold an address somebody typed, and one that was never confirmed is not
 * something the club should keep sitting in a table.
 */
export async function sweepSignups(): Promise<number> {
  const { count } = await prisma.signupVerification.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  })

  return count
}
