import { createHash, randomBytes } from 'node:crypto'
import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { HTTPException } from 'hono/http-exception'
import { prisma } from '../core/db.js'
import { env } from '../core/env.js'
import { demoteIfLapsed } from '../membership/membershipSweep.js'
import type { UserRole } from '../generated/prisma/enums.js'

/**
 * Signing in: the session token, the cookie it rides in, and the middleware that turns
 * one into a user.
 *
 * Server-side sessions rather than a signed token, because what the club will want one
 * day is to end one — an officer's laptop left in the lab, an account handed on at the
 * end of a term. A JWT can't be recalled before it expires, and the revocation list
 * that fixes that is this table with extra steps.
 *
 * The token is 256 bits of randomness and only its SHA-256 ever reaches the database,
 * so a dump of `sessions` is a list of hashes rather than a drawer of live logins.
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
  surveyPromptDismissedAt: Date | null
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
  // Carried on the session because the nav bar and the dashboard rail both draw an
  // avatar from it and have nothing else to go on. The framing rides with it for the
  // same reason: an avatar drawn without it is a centred crop, which is the one thing
  // somebody who has just framed their photo would notice, in two places at once.
  photoUrl: true,
  photoFocalX: true,
  photoFocalY: true,
  photoZoom: true,
  duesPaidThrough: true,
  // The gate, read straight off this row.
  //
  // The two survey columns are here for a weaker reason: neither refuses anything. They
  // decide whether the dashboard still has a survey to ask for, and they ride on the
  // session because `GET /dues/status` is the one call the rail already makes — asking
  // `member_surveys` instead would be a query per request to learn something that
  // changes twice in a member's life.
  surveyCompletedAt: true,
  surveyPromptDismissedAt: true,
} as const

const DAY_MS = 24 * 60 * 60 * 1000

const ttlMs = () => env.SESSION_TTL_DAYS * DAY_MS

/** The token is a credential, so only its hash is ever stored or compared. */
const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex')

/**
 * Issue a session and hand back the raw token, which is the only time it exists
 * anywhere but the browser.
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
 * End every session this account has except the one making the request.
 *
 * What "change my password" is expected to do. A password change that leaves the old
 * one signed in on a laptop in the lab hasn't done the thing somebody pressed it for —
 * and the case that matters is where they're changing it because somebody else has it.
 *
 * The caller's own session survives, or the answer to changing a password would be a
 * login form.
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
 * The reset flow's version: whoever is setting a password from an emailed link isn't
 * signed in, so there's nothing to keep — and if the reason for the reset is that
 * somebody else got in, leaving them signed in is what the flow exists to prevent.
 */
export async function dropAllSessions(userId: string): Promise<number> {
  const { count } = await prisma.session.deleteMany({ where: { userId } })

  return count
}

export async function destroySession(token: string): Promise<void> {
  // `deleteMany`, not `delete`: signing out of a session already expired and swept
  // isn't an error, it's the same outcome.
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } })
}

/**
 * Set the session cookie.
 *
 * `httpOnly`, so script on the page can't read it — the one property that turns a
 * cross-site scripting bug from "somebody's session is stolen" into "somebody's page
 * looked wrong". `secure` follows `SITE_URL`, because a cookie marked `Secure` is never
 * sent over the plain http a development box serves, and sign-in would appear to work
 * and never stick.
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
  // The attributes have to match the ones it was set with, or the browser keeps the
  // original cookie and deletes nothing.
  deleteCookie(c, env.SESSION_COOKIE_NAME, {
    secure: env.SITE_URL.startsWith('https://'),
    sameSite: env.SESSION_COOKIE_SAMESITE === 'none' ? 'None' : 'Lax',
    domain: env.SESSION_COOKIE_DOMAIN,
    path: '/',
  })
}

/**
 * Resolve the cookie on a request to a user, rolling the session forward if it's far
 * enough through its life to be worth a write.
 *
 * The expiry is an idle timeout: every use pushes it out, so somebody who turns up to
 * build nights is never signed out mid-term while a browser left on a lab machine still
 * goes stale. Refreshing on every request would mean a write per request, so it only
 * happens past halfway — at most one extra write per fortnight per person.
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
    // Expired but not yet swept. Taken out now rather than left for the timer — the
    // browser is here, and clearing its cookie is the difference between signing in
    // again and wondering why nothing happens.
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
    // The cookie carries its own expiry, so rolling the row without re-sending it would
    // sign somebody out of a session the server still considers live.
    setSessionCookie(c, token, expiresAt)
  }

  c.set('sessionToken', token)

  // Live, rather than waiting on the ten-minute sweep: somebody whose dues ran out while
  // they were reading the page is a guest on their next click. Costs nothing for almost
  // everybody, and the answer replaces the role on the user this request goes on to use.
  return { ...session.user, role: await demoteIfLapsed(session.user) }
}

/**
 * Attach the user if there is one, and carry on either way.
 *
 * For the routes that answer differently rather than refusing — `/auth/me` is the only
 * one so far, and it returns `{ user: null }` rather than a 401, because "nobody is
 * signed in" is a normal state of the front page.
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
 * Refuse a request whose `Origin` isn't one the site is served from.
 *
 * The cross-site request forgery guard, and it earns its place the moment
 * `SESSION_COOKIE_SAMESITE` is set to `none` for a deploy where the site and the API are
 * on different domains — `lax` closes this by itself, `none` doesn't, and the setting
 * that opens the hole is a long way from the routes that fall through it.
 *
 * An absent `Origin` is allowed on purpose. Browsers send it on every request that
 * isn't a plain GET, so anything a forged page can make carries one; what arrives
 * without is `curl`, a health check, or the test suite.
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
