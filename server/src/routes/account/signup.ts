import { createHash, randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { validate } from '../../core/validate.js'
import { prisma } from '../../core/db.js'
import {
  type DiscordCheck,
  checkDiscordHandle,
  isHandleShaped,
  normaliseHandle,
  officerRoleId,
} from '../../discord/discord.js'
import { pushRoles } from '../../discord/discordRoles.js'
import { env } from '../../core/env.js'
import { UserRole } from '../../generated/prisma/enums.js'
import { sendSignupVerification } from '../../email/mail.js'
import { hashPassword } from '../../auth/password.js'
import { consume, rateLimit } from '../../core/rateLimit.js'

/**
 * Signup: joining the club is creating an account.
 *
 * Two requests with an email in between, and the shape is the point. The first says
 * an address and gets a link; the second arrives with that link's token and
 * everything else. Nothing about the person is stored until the address is proved,
 * so a bot working through a list leaves rows in `signup_verifications` that expire
 * on their own rather than half-built users somebody has to sort out.
 *
 *   POST /api/signup/start          { email, acknowledged } -> 202
 *   POST /api/signup/verify         { token }               -> 200 { email }
 *   POST /api/signup/discord-check  { discordUsername }     -> 200 { status }
 *   POST /api/signup/complete       { token, ... }          -> 201 { id }
 *
 * Unauthenticated — there's no session yet — so every field is capped and every
 * route is rate limited.
 *
 * The account lands at GUEST with no slug. GUEST keeps it out of the membership
 * count and the Discord Members role; it doesn't keep the account off `/members`,
 * which lists everybody. The password is taken now because asking everyone to come
 * back and set one later is how you get a roster of accounts nobody can get into.
 */
export const signup = new Hono()

/**
 * Two budgets, because two different things are being limited.
 *
 * `writes` covers the requests that cost something — an email sent, an account
 * created — and shares the site's default five. `checks` covers what a form makes on
 * the visitor's behalf while they're still filling it in: the Discord field
 * re-checks as a typo is corrected, and a mail app that prefetches can verify more
 * than once. Five of those bites the people it's meant to serve.
 */
const writes = rateLimit('signup')
const checks = rateLimit('signup-check', 30)

/**
 * A floor under `writes`, for the one endpoint of the four that sends mail.
 *
 * `writes` is a ten-minute allowance, and an allowance says nothing about shape —
 * all five can be spent in the same second at five different `@ucf.edu` addresses,
 * which is five students opening their inbox to a confirmation link they never asked
 * for. Thirty seconds is longer than a mail round trip and shorter than anyone's
 * patience, so it costs a real person nothing and costs the loop its whole rate.
 *
 * Its own scope, because a scope holds one row per caller and this is a second window
 * on the same one. Middleware rather than a `consume` in the handler: spending this
 * on a malformed body is right, because nothing about a request's shape says whether
 * a person sent it.
 *
 * Deliberately not on `/complete`, which mails nobody — half a minute between
 * attempts at your own password is a punishment for typing.
 */
const START_COOLDOWN_SECONDS = 30

const startCooldown = rateLimit('signup-burst', 1, {
  windowSeconds: START_COOLDOWN_SECONDS,
  message:
    'Give it half a minute before asking for another confirmation email — the last one may still be on its way.',
})

/**
 * And the budget keyed on the address rather than the caller.
 *
 * This endpoint puts mail in somebody else's inbox, so the thing worth limiting is
 * how often one address can be made to receive it. A per-caller budget alone lets a
 * botnet mail one student a link all afternoon from a different address every time.
 * Three, because the third is already the "check your spam" attempt.
 */
const PER_ADDRESS_MAX = 3

/**
 * Membership is for current UCF students, and this is the line the whole first step
 * draws. `@knights.ucf.edu` is UCF's old student domain and is deliberately not
 * accepted: the address has to be one the club can still reach someone at, and
 * knights addresses stop resolving after graduation.
 */
const STUDENT_DOMAIN = '@ucf.edu'

const studentEmail = z
  .string()
  // Trimmed and lowercased before validation, not after: a pasted address carries a
  // trailing space often enough to matter, and `z.email()` would reject it on the
  // space rather than say anything useful. Lowercase is what makes the unique
  // constraint on `User.email` mean one address rather than one spelling of it.
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
   * `z.literal(true)` and not `boolean()`: the disclaimer is the one thing this step
   * is for, and a checkbox is only a promise the browser makes.
   */
  acknowledged: z.literal(true),
})

const tokenSchema = z.object({ token: z.string().min(1).max(200) })

const handleSchema = z.object({
  discordUsername: z.string().trim().min(1).max(64),
})

const completeSchema = z.object({
  token: z.string().min(1).max(200),
  // Split rather than one "full name" field so the club can address people by their
  // first name in mail. Stored joined in `User.fullName`, which is the column the
  // roster and every listing already read.
  firstName: z.string().trim().min(1).max(50),
  lastName: z.string().trim().min(1).max(50),
  /**
   * Long, and nothing else. Composition rules push people toward `Password1!` and are
   * no longer advised by anyone who has measured them; length is the part that helps.
   * The cap isn't policy — scrypt is deliberately expensive, and an unbounded input
   * is a way to make the server do arbitrary work.
   */
  password: z.string().min(10).max(200),
  discordUsername: z.string().trim().min(1).max(64),
  /**
   * The member acknowledgement — safety, equipment, conduct, dues.
   *
   * `z.literal(true)` for the reason `/start` uses it: posting straight at this
   * endpoint must not be a way past reading the thing. Separate from that first box
   * on purpose — one says who may join, this is what they're agreeing to.
   *
   * When it was accepted is written to the account, because an agreement the club
   * can't produce afterwards hasn't done its job.
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
 * They're the same thing from where the visitor is standing — the link doesn't work,
 * ask for another — and telling them apart would confirm which tokens exist.
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
 * Duck-typed on the error code rather than caught by class: Prisma's error classes
 * move between packages across major versions.
 *
 * Where the offending column is named does move. Prisma 6 put it in `meta.target`;
 * Prisma 7 goes through a driver adapter and the field names arrive under
 * `meta.driverAdapterError.cause`, in database spelling. All three places are
 * searched, the Postgres message included, because the alternative when this stops
 * matching is a 500 on a case the route already knows how to answer.
 *
 * Two columns spell 'discord' — the handle and the account id — and both landing on
 * one answer is deliberate: a snowflake already on file under another handle is the
 * same situation from the visitor's side.
 *
 * Exported for `routes/account/account.ts`, which writes the same two columns from
 * the profile page. A second copy would drift the next time Prisma moves this.
 */
export function uniqueConflict(error: unknown): 'email' | 'discord' | null {
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

/** Shared with the profile page's Discord field, which trips the same constraint
    from the other direction — one sentence, one spelling. */
export const DISCORD_TAKEN =
  'That Discord username is already connected to another account.'

// ------------------------------------------------------------------- start

signup.post(
  '/start',
  startCooldown,
  writes,
  validate('json', startSchema),
  async (c) => {
    const { email } = c.req.valid('json')

    // Before the lookup, so an address can't be asked about more often than it can be
    // mailed. Keyed on the address itself, the only key a caller changing IP on every
    // request can't get away from.
    const address = await consume(
      `signup-address:${email}`,
      PER_ADDRESS_MAX,
      env.RATE_LIMIT_WINDOW_SECONDS,
    )

    if (!address.allowed) {
      c.header('Retry-After', String(address.retryAfter))
      throw new HTTPException(429, {
        message:
          'A confirmation link has already been sent to that address. Check your spam folder, or try again in a little while.',
      })
    }

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

    // Upsert, so asking again replaces the pending signup instead of leaving two live
    // links for one address. `verifiedAt` resets with it: a fresh link voids the old
    // one, including one already followed.
    await prisma.signupVerification.upsert({
      where: { email },
      update: { tokenHash, expiresAt, verifiedAt: null },
      create: { email, tokenHash, expiresAt },
    })

    // Awaited, unlike the contact notification. There the email is a courtesy on top
    // of a stored row; here it's the only way the signup can continue, so "sent" has
    // to be something this route knows rather than assumes.
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
        // rather than showing them a link that will never arrive.
        console.error(
          'signup: POSTMARK_TOKEN is not configured — no verification email can be sent',
        )
        throw new HTTPException(503, {
          message:
            'Signups are temporarily unavailable. Please try again later, or contact an officer.',
        })
      }

      // Development without a Postmark account, which is the normal state of a
      // checkout. The link goes to the log so the flow can be walked end to end; never
      // into the response, because a token the caller is handed proves nothing about
      console.log(
        `signup ${email}: no mailer configured — verification link is ${env.signupVerifyUrl}?token=${encodeURIComponent(token)}`,
      )
    }

    // 202: the address is on record and the link is out, but nobody has an account yet
    // and won't until the second request. The expiry goes back so the page can say how
    // long they have without hardcoding a number from this server's configuration.
    return c.json(
      {
        status: 'sent',
        email,
        expiresInMinutes: env.SIGNUP_TOKEN_TTL_MINUTES,
      },
      202,
    )
  },
)

// ------------------------------------------------------------------ verify

signup.post('/verify', checks, validate('json', tokenSchema), async (c) => {
  const pending = await requirePending(c.req.valid('json').token)

  // Only the first time. Re-following a link — a mail app that prefetches, a reload of
  // the finish page — must not keep moving the timestamp, or it stops recording when
  // the address was actually proved.
  if (!pending.verifiedAt) {
    await prisma.signupVerification.update({
      where: { id: pending.id },
      data: { verifiedAt: new Date() },
    })
  }

  // The address comes back so the finish page can show whose account is being set up.
  // Somebody with three UCF addresses forwarded into one inbox needs to see which.
  return c.json({ email: pending.email })
})

// ----------------------------------------------------------- discord-check

/** What the field is told: Discord's four answers plus the one only this site can
    give. */
export type HandleStatus = DiscordCheck | { status: 'taken' }

/**
 * Is this handle a real account in the club's Discord, and is it free?
 *
 * The whole rule in one place, because two forms ask it: the signup field below, and
 * the profile page's.
 *
 * `exceptUserId` is what makes it usable from the profile page — without it, somebody
 * re-saving the handle they already have is told it's taken, by themselves. It's a
 * whitelist of exactly one row, so it can't be used to claim anybody else's.
 *
 * Nothing here writes, and the answer isn't trusted at the point of the write: both
 * `complete` and the profile route ask again.
 */
export async function handleStatus(
  raw: string,
  exceptUserId: string | null = null,
): Promise<HandleStatus> {
  const handle = normaliseHandle(raw)

  if (!isHandleShaped(handle)) {
    // A display name — capitals, spaces, punctuation Discord doesn't allow — is the
    // usual reason to land here, and it isn't a real handle, so it gets the same
    // answer as one that doesn't exist. A complaint about legal characters wouldn't
    // tell anyone what to type instead; the screenshot beside the field does.
    return { status: 'not_found' }
  }

  const taken = await prisma.user.findUnique({
    where: { discordUsername: handle },
    select: { id: true },
  })

  if (taken && taken.id !== exceptUserId) return { status: 'taken' }

  return await checkDiscordHandle(handle)
}

/**
 * Its own endpoint because the field asks while it's being filled in, and because
 * its two answers are worth separating: "we can't find you" sends somebody to the QR
 * code on the same card, "already connected" doesn't.
 *
 * Unauthenticated, so no caller is excused — a signup has no account yet. The profile
 * page has its own copy behind `requireAuth`.
 */
signup.post(
  '/discord-check',
  checks,
  validate('json', handleSchema),
  async (c) => {
    return c.json(await handleStatus(c.req.valid('json').discordUsername))
  },
)

// ---------------------------------------------------------------- complete

signup.post(
  '/complete',
  writes,
  validate('json', completeSchema),
  async (c) => {
    const { token, firstName, lastName, password, discordUsername } =
      c.req.valid('json')
    // Read now rather than at the write below: this is the moment the agreement was
    // made, and the scrypt hash between here and there takes long enough to be worth
    // not folding into the timestamp.
    const acknowledgementAcceptedAt = new Date()

    const pending = await requirePending(token)
    const handle = normaliseHandle(discordUsername)

    // Asked again, from here. The field already checked itself, but that answer went
    // to a browser and came back, and this is the value the club's tooling will join
    // on for the next several years.
    const check = isHandleShaped(handle)
      ? await checkDiscordHandle(handle)
      : ({ status: 'not_found' } as const)

    if (check.status === 'not_found') {
      throw new HTTPException(422, { message: 'Cannot find that user.' })
    }

    if (check.status === 'unavailable') {
      // Discord is down or the bot is misconfigured. Refusing costs someone a few
      // minutes; accepting writes an unconfirmed handle that looks exactly like a
      // confirmed one from then on.
      throw new HTTPException(503, {
        message:
          'We could not reach Discord to confirm that username. Try again in a minute.',
      })
    }

    // `connected` gives Discord's own spelling back; `unchecked` means no bot is
    // configured and the handle stands as the visitor typed it.
    const confirmedHandle =
      check.status === 'connected' ? check.username : handle

    // The account's snowflake, when Discord was actually asked. The half that survives
    // somebody changing their username, and what the bot addresses a direct message
    // to. Null when no bot is configured, which is the state every row created before
    // the check existed is in.
    const confirmedId = check.status === 'connected' ? check.id : null

    /**
     * Whether the guild says this person is on the board.
     *
     * The answer is already in hand — the check above returns the roles the search came
     * back with — so this costs no second call. False whenever no bot is configured or
     * the club hasn't set a role id.
     *
     * An officer signing up and landing as a guest was a real gap: their own desks
     * hidden until somebody opened Prisma Studio, with the sweep fixing it eventually —
     * and "eventually" is after the first thing they tried to do failed.
     */
    const officerByDiscord =
      officerRoleId !== null &&
      check.status === 'connected' &&
      check.roles.includes(officerRoleId)

    const passwordHash = await hashPassword(password)

    try {
      const { id } = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            // Stored joined because `fullName` is the column the roster, the officer
            // cards and every listing already read. Splitting it is a schema change
            // and a migration for every one of them.
            fullName: `${firstName} ${lastName}`,
            email: pending.email,
            passwordHash,
            discordUsername: confirmedHandle,
            discordId: confirmedId,
            acknowledgementAcceptedAt,
            // `GUEST` unless the club's Discord says otherwise, spelled out rather than
            // left to the column default now that the line above can say otherwise. A
            // plain signup isn't a roster entry, so `joinedAt` stays null — that's the
            // date somebody became a member, and `createdAt` already records the signup.
            //
            // An officer is the exception on both counts: they are a member by being on
            // the board, and an officer with no `joinedAt` prints a blank year on their
            // public profile.
            //
            // Still no slug, for either. A profile page of one's own stays a decision a
            // person makes.
            role: officerByDiscord ? UserRole.OFFICER : UserRole.GUEST,
            joinedAt: officerByDiscord ? acknowledgementAcceptedAt : null,
          },
          select: { id: true },
        })

        // In the same transaction as the account. Spending the link separately could
        // leave it live beside a created account, or spend it against an account that
        // failed to write.
        await tx.signupVerification.delete({ where: { id: pending.id } })

        return created
      })

      // A brand new account has no dues and no projects, so this almost always works
      // out to nothing. It runs anyway because "almost" is doing work: an officer can
      // have granted them a term before they finished signing up, and this is the first
      // moment the site knows their handle.
      pushRoles(id, 'account created')

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
