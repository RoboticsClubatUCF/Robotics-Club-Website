import { createHash, randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { validate } from '../../core/validate.js'
import { prisma } from '../../core/db.js'
import type { OfficerRefreshReport } from '../../discord/discordOfficers.js'
import { refreshOfficerStanding } from '../../discord/discordOfficers.js'
import { env } from '../../core/env.js'
import { sendPasswordReset } from '../../email/mail.js'
import {
  NO_SUCH_PASSWORD,
  hashPassword,
  needsRehash,
  verifyPassword,
} from '../../auth/password.js'
import { consume, rateLimit } from '../../core/rateLimit.js'
import {
  type AuthEnv,
  clearSessionCookie,
  createSession,
  destroySession,
  dropAllSessions,
  optionalAuth,
  originGuard,
  setSessionCookie,
} from '../../auth/session.js'

/**
 * Signing in, signing out, and who is asking.
 *
 *   POST /api/auth/login             { email, password }    -> 200 { user } + cookie
 *   POST /api/auth/logout                                   -> 200
 *   GET  /api/auth/me                                       -> 200 { user | null }
 *   POST /api/auth/password/forgot   { email }              -> 202, whatever it finds
 *   POST /api/auth/password/reset    { token, password }    -> 200
 *
 * Outside `publicApi`, like signup: none of it is cacheable, and an etag on "who am
 * I" would be actively wrong.
 *
 * No registration here — creating an account is `POST /api/signup/*`.
 */
export const auth = new Hono<AuthEnv>()

/**
 * Two budgets, because password guessing comes in two shapes and only one is stopped
 * by counting callers.
 *
 * `attempts` is per caller and stops one browser working through a list of addresses.
 * Deliberately wider than the site's default five: a login is a whole building.
 * Campus wifi, a dorm and anything behind a NAT arrive from one address, so five
 * would bite a lecture theatre and not one attacker.
 *
 * `PER_ACCOUNT_MAX` is what actually protects a member, and it's the tighter of the
 * two on purpose. The attack worth worrying about is spread across callers — a
 * botnet trying `Knights2024!` against every account in turn never trips a per-caller
 * limit — so the budget that matters is keyed on the account being guessed at. Ten,
 * because the person most likely to spend it is somebody who can't remember which
 * password they used.
 */
const attempts = rateLimit('login', 20)
const PER_ACCOUNT_MAX = 10

const credentials = z.object({
  // Trimmed and lowercased before validation, the same way signup does it, so the
  // address someone types matches the one the unique constraint stored.
  email: z.string().trim().toLowerCase().pipe(z.email().max(200)),
  // No minimum. The rule belongs where a password is set; applying it here would
  // refuse to even check passwords of accounts created before the rule, and tell an
  // attacker the shape of what they're looking for.
  password: z.string().min(1).max(200),
})

/**
 * One sentence for every way sign-in can fail.
 *
 * No account, wrong password, and an account that has never had a password set are
 * one answer on purpose. Telling them apart turns the login form into a way to ask
 * whether a given student is a member, one address at a time.
 */
const REFUSED = 'That email and password do not match an account.'

/**
 * What the browser is told about whoever is signed in.
 *
 * Exported, because `routes/account/account.ts` answers with the same object after
 * every write that changes one of these fields — the page adopts it into the session
 * context rather than re-reading `/auth/me`, and two spellings of "the current user"
 * is how the nav ends up disagreeing with the page under it.
 *
 * `photoUrl` and its framing are here and the rest of the profile isn't: the nav bar
 * and the dashboard rail draw an avatar and have nothing else to go on.
 */
export const shape = (user: {
  id: string
  fullName: string
  email: string | null
  slug: string | null
  role: string
  discordUsername: string | null
  photoUrl: string | null
  photoFocalX: number
  photoFocalY: number
  photoZoom: number
}) => ({
  id: user.id,
  fullName: user.fullName,
  email: user.email,
  slug: user.slug,
  role: user.role,
  discordUsername: user.discordUsername,
  photoUrl: user.photoUrl,
  photoFocalX: user.photoFocalX,
  photoFocalY: user.photoFocalY,
  photoZoom: user.photoZoom,
})

/**
 * The account as it is after the officer sync has had its say.
 *
 * Only when something moved, which is nearly never. Read back from the database
 * rather than patched in place: a promotion is always `OFFICER`, but a demotion lands
 * on whatever the dues loop says, and working that out again here is how the two
 * answers start to disagree.
 */
async function reread<T extends { id: string; role: string }>(
  user: T,
  officer: OfficerRefreshReport,
): Promise<T> {
  if (!officer.promoted && !officer.demoted) return user

  const fresh = await prisma.user.findUnique({
    where: { id: user.id },
    select: { role: true },
  })

  return fresh ? { ...user, role: fresh.role } : user
}

// ------------------------------------------------------------------- login

auth.post(
  '/login',
  originGuard,
  attempts,
  validate('json', credentials),
  async (c) => {
    const { email, password } = c.req.valid('json')

    // Keyed on the address rather than the caller, which is the point of the second
    // budget. Consumed before the password is checked, so a correct guess on the
    // eleventh attempt is worth no more than a wrong one.
    const account = await consume(
      `login-account:${email}`,
      PER_ACCOUNT_MAX,
      env.RATE_LIMIT_WINDOW_SECONDS,
    )

    if (!account.allowed) {
      c.header('Retry-After', String(account.retryAfter))
      throw new HTTPException(429, {
        message:
          'Too many sign-in attempts for that account. Try again in a little while.',
      })
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        fullName: true,
        email: true,
        slug: true,
        role: true,
        discordUsername: true,
        photoUrl: true,
        photoFocalX: true,
        photoFocalY: true,
        photoZoom: true,
        passwordHash: true,
      },
    })

    // Run scrypt even with nobody to check against. Returning early would make a
    // missing account roughly a hundred milliseconds faster than a wrong password, and
    // that difference is a membership lookup for anyone timing it.
    const ok = await verifyPassword(password, user?.passwordHash ?? NO_SUCH_PASSWORD)

    if (!user || !user.passwordHash || !ok) {
      throw new HTTPException(401, { message: REFUSED })
    }

    /**
     * Convert an imported bcrypt row to scrypt, now that the plaintext exists.
     *
     * The only moment it can be done: a hash can't be converted from the outside, and
     * re-hashing the hash would produce something no password opens. So it happens on
     * the one request per account where a correct password has just been proved.
     *
     * Swallowed on failure: the sign-in has already succeeded, the old hash still
     * works, and the next sign-in gets another attempt. Failing here would cost
     * somebody their session over bookkeeping.
     */
    if (needsRehash(user.passwordHash)) {
      try {
        await prisma.user.update({
          where: { id: user.id },
          data: { passwordHash: await hashPassword(password) },
        })
      } catch (error: unknown) {
        console.error(`password: could not rehash ${user.id}`, error)
      }
    }

    /**
     * Follow the club's Discord officer role before answering.
     *
     * The sweep runs every ten minutes, and the person most likely to be standing in
     * that window is the one just handed the role and told to sign in. They'd arrive
     * to a dashboard with no officer desks, which reads as broken rather than queued.
     *
     * It follows the role both ways, and can only do that safely because it checks the
     * configured role id against the guild's own role list first —
     * `discordOfficers.ts` has the argument.
     *
     * `force`, because the throttle behind this exists for the page-load read below.
     * It refuses silently when Discord is unreachable, so nothing about signing in
     * depends on Discord answering.
     */
    const officer = await refreshOfficerStanding(user.id, { force: true })

    const { token, expiresAt } = await createSession(user.id)
    setSessionCookie(c, token, expiresAt)

    // Re-read only when something actually changed, so the ordinary sign-in is no more
    // queries than it was. `shape` would otherwise print the role that was true a
    // moment before. Read back rather than patched: a demotion lands on whatever the
    // dues loop says, which is `standingRole`'s decision.
    return c.json({ user: shape(await reread(user, officer)) })
  },
)

// ------------------------------------------------------------------ logout

/**
 * `requireAuth` deliberately not used: signing out has to work from a session the
 * server has already forgotten, or a stale cookie is a browser that can never get
 * back to a clean state. The cookie is cleared either way.
 */
auth.post('/logout', originGuard, async (c) => {
  const token = getCookie(c, env.SESSION_COOKIE_NAME)
  if (token) await destroySession(token)

  clearSessionCookie(c)

  return c.json({ status: 'signed-out' })
})

// ---------------------------------------------------------------------- me

/**
 * `{ user: null }` and a 200 rather than a 401, because not being signed in is the
 * ordinary state of somebody reading the front page — not a failure, and not
 * something to put a red line in their console about on every load.
 */
auth.get('/me', optionalAuth, async (c) => {
  const user = c.get('user')

  if (!user) return c.json({ user: null })

  /**
   * The other half of following the officer role live: somebody handed it while
   * already signed in never posts to `/login` again, and this is the one request
   * every page of theirs makes.
   *
   * Not `force`, so it's throttled to one Discord lookup per person every few minutes,
   * and it returns before any call at all for anyone whose role and tenure are already
   * settled — most of the people reloading a dashboard.
   */
  const officer = await refreshOfficerStanding(user.id)

  return c.json({ user: shape(await reread(user, officer)) })
})


// ------------------------------------------------------- password reset

/**
 * Getting back in without a password.
 *
 * The same shape as signup's verification and for the same reasons: a link mailed to
 * an address, stored only as a SHA-256, spent by a POST the reset page makes rather
 * than by the GET that opens it — mail scanners follow every URL in an incoming
 * message, and against a GET endpoint that spends the link before the student clicks.
 *
 * Until this existed the login page told people to ask an officer, who set a hash by
 * hand in Prisma Studio.
 */

const resetRequests = rateLimit('password-reset', 5)

/**
 * And a floor under those five: thirty seconds between one caller's requests.
 *
 * `resetRequests` is a ten-minute allowance, and an allowance says nothing about
 * shape — all five can be spent in the same second at five different addresses, which
 * is five people opening their inbox to a reset link they didn't ask for. Thirty
 * seconds is longer than a mail round trip and shorter than anyone's patience.
 *
 * Its own scope, because it's a different window on the same caller. Middleware
 * rather than a `consume` in the handler: spending this on a malformed body is right,
 * since nothing about a request's shape tells you whether a person sent it.
 *
 * Deliberately not on `/password/reset`, which mails nobody — a thirty-second wait
 * between attempts at your own new password is a punishment for typing.
 */
const RESET_COOLDOWN_SECONDS = 30

const resetCooldown = rateLimit('password-reset-burst', 1, {
  windowSeconds: RESET_COOLDOWN_SECONDS,
  message:
    'Give it half a minute before asking for another reset link — the last one may still be on its way.',
})

/**
 * The second budget, keyed on the address rather than the caller.
 *
 * This endpoint sends mail to somebody else's inbox, so the thing worth limiting is
 * how often one address can be made to receive it — a per-caller budget alone lets a
 * botnet mail one person a reset link all afternoon from a different address every
 * time. Three, because the third is already the "check your spam" attempt.
 */
const PER_ADDRESS_MAX = 3

/** The token is a credential, so only its hash is ever compared or stored. */
const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex')

/**
 * One answer whatever is found, and it's the whole security property.
 *
 * A 404 for an unknown address would turn this into a membership lookup — type an
 * address, learn whether that person is in the club. So the sentence is about what
 * would happen rather than what did.
 */
const SENT =
  'If there is an account for that address, a link to set a new password is on its way.'

auth.post(
  '/password/forgot',
  originGuard,
  resetCooldown,
  resetRequests,
  validate('json', z.object({ email: credentials.shape.email })),
  async (c) => {
    const { email } = c.req.valid('json')

    const address = await consume(
      `password-reset-address:${email}`,
      PER_ADDRESS_MAX,
      env.RATE_LIMIT_WINDOW_SECONDS,
    )

    if (!address.allowed) {
      c.header('Retry-After', String(address.retryAfter))
      throw new HTTPException(429, {
        message:
          'A link has already been sent to that address. Check your spam folder, or try again in a little while.',
      })
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    })

    // Nobody by that address. Answered exactly as a hit is, and deliberately without
    // the ~100ms of scrypt the login route spends matching its timing: nothing is
    // hashed on either branch here, so both cost one indexed read.
    if (!user) return c.json({ status: 'sent', message: SENT }, 202)

    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(
      Date.now() + env.ACCOUNT_TOKEN_TTL_MINUTES * 60_000,
    )
    const tokenHash = hashToken(token)

    // Upsert on the account, so asking again replaces the pending reset rather than
    // leaving two live links — the same reasoning as signup's upsert, and what makes
    // "I never got it, send it again" safe.
    await prisma.passwordReset.upsert({
      where: { userId: user.id },
      update: { tokenHash, expiresAt },
      create: { userId: user.id, tokenHash, expiresAt },
    })

    let sent: boolean

    try {
      sent = await sendPasswordReset(email, token)
    } catch (error) {
      console.error(`password reset ${email}: email failed`, error)
      throw new HTTPException(502, {
        message:
          'We could not send that email just now. Try again in a minute.',
      })
    }

    if (!sent) {
      if (env.NODE_ENV === 'production') {
        console.error(
          'password reset: POSTMARK_TOKEN is not configured — no reset email can be sent',
        )
        throw new HTTPException(503, {
          message:
            'Password resets are temporarily unavailable. Please contact an officer.',
        })
      }

      // Development with no Postmark account, which is the normal state of a checkout.
      // The link goes to the log so the flow can be walked end to end; never into the
      // response, because a token handed to the caller proves nothing about the
      // address it was meant for.
      console.log(
        `password reset ${email}: no mailer configured — reset link is ${env.passwordResetUrl}?token=${encodeURIComponent(token)}`,
      )
    }

    return c.json({ status: 'sent', message: SENT }, 202)
  },
)

auth.post(
  '/password/reset',
  originGuard,
  resetRequests,
  validate(
    'json',
    z.object({
      token: z.string().min(1).max(200),
      /**
       * Long, and nothing else — the same rule as signup, and the comment there is the
       * argument. It belongs here because this is a point where a password is set.
       */
      password: z.string().min(10).max(200),
    }),
  ),
  async (c) => {
    const { token, password } = c.req.valid('json')

    const pending = await prisma.passwordReset.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { id: true, userId: true, expiresAt: true },
    })

    // Expired, unknown and already-spent are one 410 with one sentence, exactly as
    // signup does it: they're the same thing from where the person is standing, and
    // telling them apart would confirm which tokens exist.
    if (!pending || pending.expiresAt <= new Date()) {
      throw new HTTPException(410, {
        message:
          'That link has expired or has already been used. Ask for a new one from the sign-in page.',
      })
    }

    const passwordHash = await hashPassword(password)

    // One transaction: a password set beside a link that still works is a second way
    // in that nobody knows about.
    await prisma.$transaction([
      prisma.user.update({
        where: { id: pending.userId },
        data: { passwordHash },
      }),
      prisma.passwordReset.delete({ where: { id: pending.id } }),
    ])

    // Every session, with no exception. The reset page has none of its own to keep, and
    // if the reason for the reset is that somebody else got in, leaving that somebody
    // signed in is the one outcome this flow exists to prevent.
    await dropAllSessions(pending.userId)

    return c.json({ status: 'reset' })
  },
)

/** Drop resets that have already expired. Same timer as the other sweeps. */
export async function sweepPasswordResets(): Promise<number> {
  const { count } = await prisma.passwordReset.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  })

  return count
}
