import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { prisma } from '../db.js'
import { env } from '../env.js'
import { NO_SUCH_PASSWORD, verifyPassword } from '../password.js'
import { consume, rateLimit } from '../rateLimit.js'
import {
  type AuthEnv,
  clearSessionCookie,
  createSession,
  destroySession,
  optionalAuth,
  originGuard,
  setSessionCookie,
} from '../session.js'

/**
 * Signing in, signing out, and who is asking.
 *
 *   POST /api/auth/login   { email, password } -> 200 { user }  + session cookie
 *   POST /api/auth/logout                      -> 200
 *   GET  /api/auth/me                          -> 200 { user | null }
 *
 * Outside `publicApi`, like signup: none of it is cacheable, and an etag on
 * "who am I" would be actively wrong.
 *
 * There is no registration here — creating an account is `POST /api/signup/*`,
 * which has always written a password hash. This is the half that was missing.
 */
export const auth = new Hono<AuthEnv>()

/**
 * Two budgets, because password guessing comes in two shapes and only one of
 * them is stopped by counting callers.
 *
 * `attempts` is per caller and stops one browser working through a list of
 * addresses. It is deliberately *wider* than the site's default of five: a
 * signup or a contact message is one person doing one thing, but a login is a
 * whole building. Campus wifi, a dorm, and anything behind a NAT all arrive
 * from one address, so five would mean five sign-ins per ten minutes shared
 * between everyone on it — a limit that bites a lecture theatre and not one
 * attacker.
 *
 * `PER_ACCOUNT_MAX` is the one that actually protects a member, and it is the
 * tighter of the two on purpose. The attack worth worrying about is spread
 * across callers — a botnet trying `Knights2024!` against every account in turn
 * never trips a per-caller limit and never has to — so the budget that matters
 * is keyed on the account being guessed at. Ten, because the person most likely
 * to spend it is somebody who genuinely cannot remember which password they
 * used.
 */
const attempts = rateLimit('login', 20)
const PER_ACCOUNT_MAX = 10

const credentials = z.object({
  // Trimmed and lowercased before validation, the same way signup does it, so
  // the address someone types matches the one the unique constraint stored.
  email: z.string().trim().toLowerCase().pipe(z.email().max(200)),
  // No minimum. The rule belongs at the point a password is *set*; applying it
  // here would refuse to even check the passwords of any account created before
  // the rule, and tell an attacker the shape of what they are looking for.
  password: z.string().min(1).max(200),
})

/**
 * One sentence for every way sign-in can fail.
 *
 * No account, wrong password, and an account that has never had a password set
 * — a roster entry an officer typed in — are one answer on purpose. Telling
 * them apart turns the login form into a way to ask whether a given student is
 * a member, one address at a time.
 */
const REFUSED = 'That email and password do not match an account.'

const shape = (user: {
  id: string
  fullName: string
  email: string | null
  slug: string | null
  role: string
  discordUsername: string | null
}) => ({
  id: user.id,
  fullName: user.fullName,
  email: user.email,
  slug: user.slug,
  role: user.role,
  discordUsername: user.discordUsername,
})

// ------------------------------------------------------------------- login

auth.post(
  '/login',
  originGuard,
  attempts,
  zValidator('json', credentials),
  async (c) => {
    const { email, password } = c.req.valid('json')

    // Keyed on the address rather than the caller, which is the whole point of
    // the second budget. Consumed before the password is checked so a correct
    // guess on the eleventh attempt is worth no more than a wrong one.
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
        passwordHash: true,
      },
    })

    // Run scrypt even with nobody to check against. Returning early here would
    // make a missing account roughly a hundred milliseconds faster than a wrong
    // password, and that difference is a membership lookup for anyone timing it.
    const ok = await verifyPassword(password, user?.passwordHash ?? NO_SUCH_PASSWORD)

    if (!user || !user.passwordHash || !ok) {
      throw new HTTPException(401, { message: REFUSED })
    }

    const { token, expiresAt } = await createSession(user.id)
    setSessionCookie(c, token, expiresAt)

    return c.json({ user: shape(user) })
  },
)

// ------------------------------------------------------------------ logout

/**
 * `requireAuth` deliberately not used: signing out has to work from a session
 * the server has already forgotten, or a stale cookie is a browser that can
 * never get back to a clean state. The cookie is cleared either way.
 */
auth.post('/logout', originGuard, async (c) => {
  const token = getCookie(c, env.SESSION_COOKIE_NAME)
  if (token) await destroySession(token)

  clearSessionCookie(c)

  return c.json({ status: 'signed-out' })
})

// ---------------------------------------------------------------------- me

/**
 * `{ user: null }` and a 200 rather than a 401, because not being signed in is
 * the ordinary state of somebody reading the front page — not a failure, and
 * not something to put a red line in their console about on every load.
 */
auth.get('/me', optionalAuth, (c) => {
  const user = c.get('user')

  return c.json({ user: user ? shape(user) : null })
})
