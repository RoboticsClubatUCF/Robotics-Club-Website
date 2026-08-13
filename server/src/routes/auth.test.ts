import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../app.js'
import { prisma } from '../db.js'
import { env } from '../env.js'
import { hashPassword } from '../password.js'
import { consume } from '../rateLimit.js'

/**
 * Signing in, against the live database.
 *
 * Nothing is stubbed here — no network call leaves the process on this path, so
 * there is nothing to stub. What the suite is actually for is the handful of
 * properties that are easy to lose in a refactor and impossible to notice by
 * using the site:
 *
 *   - every way of failing gives the same answer, so the form cannot be used to
 *     ask whether a given student is a member;
 *   - the session cookie is `httpOnly`, which is what makes a cross-site
 *     scripting bug stop short of stealing sessions;
 *   - nothing in a response carries a password hash.
 */

const EMAIL = 'test-login@ucf.edu'
const PASSWORD = 'a-long-enough-password'
const NO_PASSWORD_EMAIL = 'test-login-roster@ucf.edu'

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

const login = (body: unknown, headers?: Record<string, string>) =>
  post('/api/auth/login', body, headers)

/** The cookie a `Set-Cookie` header carries, as a request would send it back. */
function cookieFrom(response: Response): string {
  const header = response.headers.get('set-cookie') ?? ''
  return header.split(';')[0] ?? ''
}

/**
 * Both budgets, every time. The counters live in Postgres and outlive the
 * process, so without this a second run inside the window fails for reasons
 * that have nothing to do with the code — and the per-account one is keyed on
 * the address, so it survives even a different machine.
 */
const clearWindows = () =>
  prisma.rateLimit.deleteMany({
    where: {
      OR: [
        { key: { startsWith: 'login:' } },
        { key: { startsWith: 'login-account:' } },
      ],
    },
  })

const clearRows = () =>
  prisma.user.deleteMany({
    where: { email: { in: [EMAIL, NO_PASSWORD_EMAIL] } },
  })

beforeEach(async () => {
  await clearWindows()
  await clearRows()

  await prisma.user.create({
    data: {
      fullName: 'Test Login',
      email: EMAIL,
      passwordHash: await hashPassword(PASSWORD),
    },
  })

  // A roster entry an officer typed in: on the books, no way to sign in.
  await prisma.user.create({
    data: { fullName: 'Roster Only', email: NO_PASSWORD_EMAIL },
  })
})

afterAll(async () => {
  await clearWindows()
  await clearRows()
  await prisma.$disconnect()
})

describe('POST /api/auth/login', () => {
  it('signs a member in and sets an httpOnly session cookie', async () => {
    const response = await login({ email: EMAIL, password: PASSWORD })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      user: { email: EMAIL, fullName: 'Test Login', role: 'GUEST' },
    })

    const setCookie = response.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain(env.SESSION_COOKIE_NAME)
    // The one property that turns a cross-site scripting bug from "somebody's
    // session is stolen" into "somebody's page looked wrong".
    expect(setCookie).toMatch(/httponly/i)
    expect(setCookie).toMatch(/samesite=lax/i)

    expect(await prisma.session.count()).toBeGreaterThan(0)
  })

  /**
   * The invariant this suite exists for. A wrong password, an address with no
   * account, and a roster entry that has never had a password set are three
   * different situations and one answer — anything else turns the login form
   * into a way to ask "is this person in the Robotics Club", one UCF address at
   * a time.
   */
  it.each([
    ['a wrong password', { email: EMAIL, password: 'not-the-password' }],
    ['an address with no account', { email: 'nobody@ucf.edu', password: PASSWORD }],
    [
      'an account that has never had a password',
      { email: NO_PASSWORD_EMAIL, password: PASSWORD },
    ],
  ])('gives the same answer to %s', async (_case, body) => {
    const response = await login(body)

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      error: 'That email and password do not match an account.',
    })
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('never puts a password hash in a response', async () => {
    const response = await login({ email: EMAIL, password: PASSWORD })

    expect(JSON.stringify(await response.json())).not.toContain('scrypt')
  })

  it('accepts the address however it was typed', async () => {
    const response = await login({
      email: `  ${EMAIL.toUpperCase()} `,
      password: PASSWORD,
    })

    expect(response.status).toBe(200)
  })

  /**
   * The limit that actually protects a member, and the one that cannot be
   * demonstrated by hammering from here.
   *
   * A botnet trying one common password against every account in turn never
   * trips a per-caller limit and never has to, so the budget that matters is
   * keyed on the account being guessed at. Every request in this process
   * arrives from the same unidentifiable caller — `app.request()` has no
   * socket, so `clientAddress` puts them all in the `unknown` bucket — which
   * means the per-caller limit would fire first and prove nothing about this
   * one. So the account's budget is spent directly, the way ten different
   * machines would spend it, and then one sign-in is attempted from a caller
   * that has spent almost nothing.
   */
  it('stops guessing at one account however many callers are trying', async () => {
    for (let spent = 0; spent < 10; spent++) {
      await consume(`login-account:${EMAIL}`, 10, env.RATE_LIMIT_WINDOW_SECONDS)
    }

    // The *correct* password, deliberately: the budget is consumed before the
    // password is checked, so a right guess on the eleventh attempt is worth no
    // more than a wrong one.
    const blocked = await login({ email: EMAIL, password: PASSWORD })

    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('Retry-After')).toBeTruthy()
    expect(await blocked.json()).toMatchObject({
      error: expect.stringContaining('that account'),
    })
  })

  /**
   * The other budget: one caller working through a list of addresses. Wider
   * than the site's default of five on purpose — a login is a whole building
   * behind one campus address, not one person doing one thing.
   */
  it('stops one caller working through a list of addresses', async () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const response = await login({
        // A different address each time, so this can only be the per-caller
        // budget running out and never the per-account one.
        email: `nobody-${attempt}@ucf.edu`,
        password: 'wrong',
      })
      expect(response.status, `attempt ${attempt + 1}`).toBe(401)
    }

    expect((await login({ email: EMAIL, password: PASSWORD })).status).toBe(429)
  })

  /**
   * The cross-site request forgery guard. It does nothing while the cookie is
   * `SameSite=Lax`, and is the only thing standing between a forged page and a
   * member's session the day somebody sets `SESSION_COOKIE_SAMESITE=none` for a
   * cross-domain deploy — which is a change in a `.env` file a long way from
   * this route.
   */
  it('refuses a request from an origin the site is not served from', async () => {
    const response = await login(
      { email: EMAIL, password: PASSWORD },
      { Origin: 'https://not-the-club.example.com' },
    )

    expect(response.status).toBe(403)
  })
})

describe('GET /api/auth/me', () => {
  /**
   * 200 with a null user rather than a 401. Not being signed in is the ordinary
   * state of the front page, and treating it as an error puts a red line in
   * every visitor's console on every load.
   */
  it('says nobody is signed in without calling it a failure', async () => {
    const response = await app.request('/api/auth/me')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ user: null })
  })

  it('recognises the cookie a sign-in handed out', async () => {
    const cookie = cookieFrom(await login({ email: EMAIL, password: PASSWORD }))

    const response = await app.request('/api/auth/me', { headers: { cookie } })

    expect(await response.json()).toMatchObject({ user: { email: EMAIL } })
  })

  it('never carries a password hash', async () => {
    const cookie = cookieFrom(await login({ email: EMAIL, password: PASSWORD }))

    const response = await app.request('/api/auth/me', { headers: { cookie } })

    expect(JSON.stringify(await response.json())).not.toContain('scrypt')
  })
})

describe('POST /api/auth/logout', () => {
  it('ends the session rather than only clearing the cookie', async () => {
    const cookie = cookieFrom(await login({ email: EMAIL, password: PASSWORD }))

    expect((await post('/api/auth/logout', {}, { cookie })).status).toBe(200)

    // The row is gone, so the cookie is worthless even to somebody who kept a
    // copy of it. Clearing the browser's cookie alone would not be signing out.
    const after = await app.request('/api/auth/me', { headers: { cookie } })
    expect(await after.json()).toEqual({ user: null })
  })

  /**
   * Signing out has to work from a session the server has already forgotten, or
   * a stale cookie is a browser that can never get back to a clean state.
   */
  it('works when there is no session to end', async () => {
    expect((await post('/api/auth/logout', {})).status).toBe(200)
  })
})

describe('an expired session', () => {
  it('is not accepted, and takes its cookie with it', async () => {
    const cookie = cookieFrom(await login({ email: EMAIL, password: PASSWORD }))

    await prisma.session.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    })

    const response = await app.request('/api/auth/me', { headers: { cookie } })

    expect(await response.json()).toEqual({ user: null })
    // Cleared then and there rather than left to the sweep: the browser is
    // here, and clearing it is the difference between signing in again and
    // wondering why nothing happens.
    expect(response.headers.get('set-cookie') ?? '').toContain(
      env.SESSION_COOKIE_NAME,
    )
  })
})
