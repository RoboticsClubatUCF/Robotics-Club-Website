import { createHash, randomBytes } from 'node:crypto'
import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { HTTPException } from 'hono/http-exception'
import { prisma } from '../core/db.js'
import { env } from '../core/env.js'
import { demoteIfLapsed } from '../membership/membershipSweep.js'
import type { UserRole } from '../generated/prisma/enums.js'

/**
 * Signing in: the session token, the cookie it rides in, and the middleware
 * that turns one into a user.
 *
 * Server-side sessions rather than a signed token, because the thing the club
 * will actually want one day is to *end* one — an officer's laptop left in the
 * lab, an account handed on at the end of a term. A JWT cannot be recalled
 * before it expires, and the revocation list that fixes that is this table with
 * extra steps.
 *
 * The token is 256 bits of randomness and only its SHA-256 ever reaches the
 * database, exactly as `SignupVerification` does it. A dump of `sessions` is
 * then a list of hashes rather than a drawer of live logins.
 */

/** What a signed-in request gets to know about who is making it. */
export interface SessionUser {
  id: string
  fullName: string
  email: string | null
  slug: string | null
  role: UserRole
  discordUsername: string | null
  photoUrl: string | null
  photoFocalX: number
  photoFocalY: number
  photoZoom: number
  duesPaidThrough: Date | null
  surveyCompletedAt: Date | null
}

/** The Hono variables `requireAuth` and `optionalAuth` set. */
export interface AuthEnv {
  Variables: {
    user: SessionUser
    sessionToken: string
  }
}

const userSelect = {
  id: true,
  fullName: true,
  email: true,
  slug: true,
  role: true,
  discordUsername: true,
  // Carried on the session because the nav bar and the dashboard rail both
  // draw an avatar from it and have nothing else to go on. The rest of the
  // profile is `GET /api/account`, which is read by the one page that edits it.
  //
  // The framing rides with it for the same reason: an avatar drawn without it
  // is a centred crop, which is the one thing somebody who has just framed
  // their photo would notice immediately and in two places at once.
  photoUrl: true,
  photoFocalX: true,
  photoFocalY: true,
  photoZoom: true,
  duesPaidThrough: true,
  // The two gates, both read straight off this row. `requireSurvey` is
  // synchronous precisely because this is here — asking `member_surveys`
  // instead would be a second query on every authenticated request.
  surveyCompletedAt: true,
} as const

const DAY_MS = 24 * 60 * 60 * 1000

const ttlMs = () => env.SESSION_TTL_DAYS * DAY_MS

/** The token is a credential, so only its hash is ever stored or compared. */
const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex')

/**
 * Issue a session and hand back the raw token, which is the only time it
 * exists anywhere but the browser.
 */
export async function createSession(userId: string): Promise<{
  token: string
  expiresAt: Date
}> {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + ttlMs())

  await prisma.session.create({
    data: { tokenHash: hashToken(token), userId, expiresAt },
  })

  return { token, expiresAt }
}

/**
 * End every session this account has *except* the one making the request.
 *
 * What "change my password" is expected to do. A password change that leaves
 * the old one signed in on a laptop in the lab has not done the thing somebody
 * pressed it for — and the case that matters is the one where they are changing
 * it *because* somebody else has it.
 *
 * The caller's own session survives, or the answer to changing a password would
 * be a login form.
 */
export async function dropOtherSessions(
  userId: string,
  keepToken: string,
): Promise<number> {
  const { count } = await prisma.session.deleteMany({
    where: { userId, tokenHash: { not: hashToken(keepToken) } },
  })

  return count
}

/**
 * End every session this account has, with no exception.
 *
 * The reset flow's version: whoever is setting a password from an emailed link
 * is not signed in, so there is nothing to keep — and if the reason they are
 * resetting is that somebody else got in, leaving that somebody signed in is
 * the one outcome the whole flow exists to prevent.
 */
export async function dropAllSessions(userId: string): Promise<number> {
  const { count } = await prisma.session.deleteMany({ where: { userId } })

  return count
}

export async function destroySession(token: string): Promise<void> {
  // `deleteMany`, not `delete`: signing out of a session that has already
  // expired and been swept is not an error, it is the same outcome.
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } })
}

/**
 * Set the session cookie.
 *
 * `httpOnly`, so script on the page cannot read it — the one property that
 * turns a cross-site scripting bug from "somebody's session is stolen" into
 * "somebody's page looked wrong". `secure` follows `SITE_URL`, because a cookie
 * marked `Secure` is simply never sent over the plain http a development box
 * serves, and sign-in would appear to work and never stick.
 */
export function setSessionCookie(
  c: Context,
  token: string,
  expiresAt: Date,
): void {
  setCookie(c, env.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.SITE_URL.startsWith('https://'),
    sameSite: env.SESSION_COOKIE_SAMESITE === 'none' ? 'None' : 'Lax',
    domain: env.SESSION_COOKIE_DOMAIN,
    path: '/',
    expires: expiresAt,
  })
}

export function clearSessionCookie(c: Context): void {
  // The attributes have to match the ones it was set with or the browser keeps
  // the original cookie and deletes nothing.
  deleteCookie(c, env.SESSION_COOKIE_NAME, {
    secure: env.SITE_URL.startsWith('https://'),
    sameSite: env.SESSION_COOKIE_SAMESITE === 'none' ? 'None' : 'Lax',
    domain: env.SESSION_COOKIE_DOMAIN,
    path: '/',
  })
}

/**
 * Resolve the cookie on a request to a user, rolling the session forward if it
 * is far enough through its life to be worth a write.
 *
 * The expiry is an *idle* timeout: every use pushes it out, so somebody who
 * turns up to build nights is never signed out mid-term while a browser left on
 * a lab machine still goes stale on schedule. Refreshing on literally every
 * request would mean a write per request, so it only happens once the session
 * is past halfway — at most one extra write per fortnight per person, for the
 * same behaviour.
 */
async function resolve(c: Context): Promise<SessionUser | null> {
  const token = getCookie(c, env.SESSION_COOKIE_NAME)
  if (!token) return null

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, expiresAt: true, user: { select: userSelect } },
  })

  if (!session) return null

  if (session.expiresAt <= new Date()) {
    // Expired but not yet swept. Take it out now rather than leaving it for the
    // timer — the browser is here, and clearing its cookie is the difference
    // between signing in again and wondering why nothing happens.
    await prisma.session.deleteMany({ where: { id: session.id } })
    clearSessionCookie(c)
    return null
  }

  const halfway = new Date(Date.now() + ttlMs() / 2)

  if (session.expiresAt < halfway) {
    const expiresAt = new Date(Date.now() + ttlMs())
    await prisma.session.update({
      where: { id: session.id },
      data: { expiresAt, lastUsedAt: new Date() },
    })
    // The cookie carries its own expiry, so rolling the row without re-sending
    // it would sign somebody out of a session the server still considers live.
    setSessionCookie(c, token, expiresAt)
  }

  c.set('sessionToken', token)

  // Live, rather than waiting on the ten-minute sweep: somebody whose dues ran
  // out while they were reading the page is a guest on their very next click.
  // Costs nothing for almost everybody — see the pre-filter in `demoteIfLapsed`
  // — and the answer replaces the role on the user this request goes on to use,
  // so nothing downstream acts on a role that was just taken away.
  return { ...session.user, role: await demoteIfLapsed(session.user) }
}

/**
 * Attach the user if there is one, and carry on either way.
 *
 * For the routes that answer differently rather than refusing — `/auth/me` is
 * the only one so far, and it returns `{ user: null }` rather than a 401,
 * because "nobody is signed in" is a normal state of the front page and not an
 * error worth putting in anyone's console.
 */
export const optionalAuth: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const user = await resolve(c)
  if (user) c.set('user', user)
  await next()
}

export const requireAuth: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const user = await resolve(c)

  if (!user) {
    throw new HTTPException(401, { message: 'Sign in to continue.' })
  }

  c.set('user', user)
  await next()
}

/**
 * Refuse a request whose `Origin` is not one the site is served from.
 *
 * This is the cross-site request forgery guard, and it earns its place the
 * moment `SESSION_COOKIE_SAMESITE` is set to `none` for a deploy where the site
 * and the API are on different domains — `lax` closes this by itself, `none`
 * does not, and the setting that opens the hole is a long way from the routes
 * that fall through it.
 *
 * An absent `Origin` is allowed on purpose. Browsers send it on every request
 * that is not a plain GET, so anything a forged page can make carries one; what
 * arrives without is `curl`, a health check, or the test suite, none of which
 * has a member's cookie to abuse in the first place.
 */
export const originGuard: MiddlewareHandler = async (c, next) => {
  const origin = c.req.header('origin')

  if (origin && !env.allowedOrigins.includes(origin)) {
    throw new HTTPException(403, { message: 'Blocked by origin policy.' })
  }

  await next()
}

/** Drop sessions that have already expired. Safe to run from every instance. */
export async function sweepSessions(): Promise<number> {
  const { count } = await prisma.session.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  })

  return count
}
