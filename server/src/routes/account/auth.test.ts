import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.js'
import { prisma } from '../../core/db.js'
import { checkDiscordHandle, guildMemberRoles, guildRoles } from '../../discord/discord.js'
import { env } from '../../core/env.js'
import { sendPasswordReset } from '../../email/mail.js'
import { hashPassword, verifyPassword } from '../../auth/password.js'
import { consume } from '../../core/rateLimit.js'
import { createSession } from '../../auth/session.js'

/**
 * Signing in, against the live database.
 *
 * The properties that are easy to lose in a refactor and impossible to notice by using the
 * site:
 *
 *   - every way of failing gives the same answer, so the form can't be used to ask whether a
 *     given student is a member;
 *   - the session cookie is `httpOnly`, which is what makes a cross-site scripting bug stop
 *     short of stealing sessions;
 *   - nothing in a response carries a password hash;
 *   - and signing in never asks Discord who is an officer: the board on the roles desk decides.
 */

/**
 * Nothing here should reach Discord any more, and the stubs are how that's proved: the dev
 * `.env` carries a live bot token. They're bare `vi.fn()`s with a default in `beforeEach`, and
 * the officer cases assert none of them was called. The role id is invented.
 */
const OFFICER_ROLE = '111111111111111111'

vi.mock('../../discord/discord.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../discord/discord.js')>()),
  officerRoleId: '111111111111111111',
  guildMemberRoles: vi.fn(),
  checkDiscordHandle: vi.fn(),
  guildRoles: vi.fn(),
}))

/**
 * Postmark is configured in the development `.env`, so an unmocked run of the reset flow
 * makes a real send to a fixture address every time. A test suite must never send mail.
 */
vi.mock('../../email/mail.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../email/mail.js')>()),
  sendPasswordReset: vi.fn(),
}))

const memberRoles = vi.mocked(guildMemberRoles)
const handleCheck = vi.mocked(checkDiscordHandle)
const roleList = vi.mocked(guildRoles)
const resetMail = vi.mocked(sendPasswordReset)

const EMAIL = 'test-login@ucf.edu'
const PASSWORD = 'a-long-enough-password'
const NO_PASSWORD_EMAIL = 'test-login-roster@ucf.edu'

/**
 * An account as it arrived from the club's previous site: the password is right, but stored
 * as bcrypt rather than scrypt.
 *
 * Pinned rather than generated, so this is a fixed cost-12 `$2b$` string of exactly the shape
 * the import carried — 699 of them — and not whatever `bcryptjs` happens to emit today.
 */
const LEGACY_EMAIL = 'test-login-legacy@ucf.edu'
const LEGACY_HASH = '$2b$12$1zCW8SFMsM.UndMzwGUzBuLE/.vT88Xbq9kdO4S80sfKU6jehpwzu'

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
 * Both budgets, every time. The counters live in Postgres and outlive the process, so without
 * this a second run inside the window fails for reasons that have nothing to do with the code
 * — and the per-account one is keyed on the address, so it survives a different machine.
 */
const clearWindows = () =>
  prisma.rateLimit.deleteMany({
    where: {
      OR: [
        { key: { startsWith: 'login:' } },
        { key: { startsWith: 'login-account:' } },
        // The reset flow's three, and the address-keyed one survives a different machine. The
        // `-burst:` window is thirty seconds, short enough to expire during a slow suite and
        // long enough to refuse the next test that asks — so it's cleared rather than waited out.
        { key: { startsWith: 'password-reset:' } },
        { key: { startsWith: 'password-reset-burst:' } },
        { key: { startsWith: 'password-reset-address:' } },
      ],
    },
  })

/**
 * The officer fixtures. Snowflakes are a repeated digit so they can't collide with a real
 * member's unique `discordId`.
 */
const WITH_ID_EMAIL = 'test-login-officer@ucf.edu'
const WITH_ID_SNOWFLAKE = '222222222222222222'
const SITTING_EMAIL = 'test-login-sitting@ucf.edu'
const SITTING_SNOWFLAKE = '444444444444444444'

const FIXTURE_EMAILS = [
  EMAIL,
  NO_PASSWORD_EMAIL,
  LEGACY_EMAIL,
  WITH_ID_EMAIL,
  SITTING_EMAIL,
]

const clearRows = async () => {
  // `OfficerTerm.userId` is `SetNull`, so deleting the people would leave their terms behind as
  // orphaned rows on the public archive. Terms first.
  await prisma.officerTerm.deleteMany({
    where: { user: { email: { in: FIXTURE_EMAILS } } },
  })
  await prisma.user.deleteMany({ where: { email: { in: FIXTURE_EMAILS } } })
}

beforeEach(async () => {
  await clearWindows()
  await clearRows()

  // Reset before the default is set, so a case asserting that Discord was
  // *not* asked is not reading the previous case's calls.
  memberRoles.mockReset()
  handleCheck.mockReset()
  roleList.mockReset()
  resetMail.mockReset()
  resetMail.mockResolvedValue(true)

  // If anything did ask, Discord would say the officer role is real and carried.
  memberRoles.mockResolvedValue({ status: 'ok', roles: [OFFICER_ROLE] })
  handleCheck.mockResolvedValue({ status: 'unchecked' })
  roleList.mockResolvedValue({
    status: 'ok',
    roles: new Map([[OFFICER_ROLE, 'Officers']]),
  })

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

  // Written straight in, deliberately. `hashPassword` can't produce a bcrypt string and must
  // not be able to — the only way one gets into this column is the import.
  await prisma.user.create({
    data: {
      fullName: 'Test Legacy',
      email: LEGACY_EMAIL,
      passwordHash: LEGACY_HASH,
    },
  })

  const passwordHash = await hashPassword(PASSWORD)

  await prisma.user.createMany({
    data: [
      // Knows its own snowflake — every account made since the signup check does.
      {
        fullName: 'Test Officer',
        email: WITH_ID_EMAIL,
        passwordHash,
        discordId: WITH_ID_SNOWFLAKE,
      },
      // On the board.
      {
        fullName: 'Test Sitting',
        email: SITTING_EMAIL,
        passwordHash,
        discordId: SITTING_SNOWFLAKE,
        role: 'OFFICER',
      },
    ],
  })

  // On the board means an open term as well as the role; `membership/board.ts` writes both.
  const sitting = await prisma.user.findUnique({
    where: { email: SITTING_EMAIL },
    select: { id: true, fullName: true },
  })
  await prisma.officerTerm.create({
    data: {
      userId: sitting!.id,
      fullName: sitting!.fullName,
      position: 'LAB_MANAGER',
      startedAt: new Date('2035-01-01'),
    },
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
    // The one property that turns a cross-site scripting bug from "somebody's session is
    // stolen" into "somebody's page looked wrong".
    expect(setCookie).toMatch(/httponly/i)
    expect(setCookie).toMatch(/samesite=lax/i)

    expect(await prisma.session.count()).toBeGreaterThan(0)
  })

  /**
   * The invariant this suite exists for. A wrong password, an address with no account, and a
   * roster entry that has never had a password set are three different situations and one
   * answer — anything else turns the login form into a way to ask "is this person in the
   * Robotics Club", one UCF address at a time.
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
   * The limit that actually protects a member, and the one that can't be demonstrated by
   * hammering from here.
   *
   * A botnet trying one common password against every account never trips a per-caller limit,
   * so the budget that matters is keyed on the account being guessed at. Every request in this
   * process arrives from the same unidentifiable caller — `app.request()` has no socket — so
   * the per-caller limit would fire first and prove nothing. The account's budget is spent
   * directly, the way ten different machines would spend it.
   */
  it('stops guessing at one account however many callers are trying', async () => {
    for (let spent = 0; spent < 10; spent++) {
      await consume(`login-account:${EMAIL}`, 10, env.RATE_LIMIT_WINDOW_SECONDS)
    }

    // The correct password, deliberately: the budget is consumed before the password is
    // checked, so a right guess on the eleventh attempt is worth no more than a wrong one.
    const blocked = await login({ email: EMAIL, password: PASSWORD })

    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('Retry-After')).toBeTruthy()
    expect(await blocked.json()).toMatchObject({
      error: expect.stringContaining('that account'),
    })
  })

  /**
   * The other budget: one caller working through a list of addresses. Wider than the site's
   * default of five on purpose — a login is a whole building behind one campus address.
   */
  it('stops one caller working through a list of addresses', async () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const response = await login({
        // A different address each time, so this can only be the per-caller budget running out
        // and never the per-account one.
        email: `nobody-${attempt}@ucf.edu`,
        password: 'wrong',
      })
      expect(response.status, `attempt ${attempt + 1}`).toBe(401)
    }

    expect((await login({ email: EMAIL, password: PASSWORD })).status).toBe(429)
  })

  /**
   * The cross-site request forgery guard. It does nothing while the cookie is `SameSite=Lax`,
   * and is the only thing between a forged page and a member's session the day somebody sets
   * `SESSION_COOKIE_SAMESITE=none` for a cross-domain deploy.
   */
  it('refuses a request from an origin the site is not served from', async () => {
    const response = await login(
      { email: EMAIL, password: PASSWORD },
      { Origin: 'https://not-the-club.example.com' },
    )

    expect(response.status).toBe(403)
  })
})

/**
 * The imported accounts, and the one property that decides whether the club can use this site
 * at all: the password people already have still works.
 *
 * The failure this guards against isn't loud. `verifyPassword` returns `false` for a stored
 * value it can't parse, so a bcrypt row it couldn't read would refuse a correct password with
 * the same 401 as a wrong one — 699 people locked out, and nothing saying why.
 */
describe('an account imported from the old site', () => {
  it('signs in with the password it already had', async () => {
    const response = await login({ email: LEGACY_EMAIL, password: PASSWORD })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      user: { email: LEGACY_EMAIL, fullName: 'Test Legacy' },
    })
  })

  it('still refuses the wrong password', async () => {
    const response = await login({ email: LEGACY_EMAIL, password: 'not-it-at-all' })

    expect(response.status).toBe(401)
  })

  it('is rewritten in scrypt by that sign-in, and opens again afterwards', async () => {
    expect(await login({ email: LEGACY_EMAIL, password: PASSWORD })).toMatchObject({
      status: 200,
    })

    const after = await prisma.user.findUnique({
      where: { email: LEGACY_EMAIL },
      select: { passwordHash: true },
    })

    expect(after?.passwordHash?.startsWith('scrypt$')).toBe(true)
    // The conversion is worth nothing if the converted row doesn't open — and this is the half
    // a rehash written from the hash rather than the plaintext would fail.
    expect(await verifyPassword(PASSWORD, after!.passwordHash!)).toBe(true)

    await clearWindows()
    expect(await login({ email: LEGACY_EMAIL, password: PASSWORD })).toMatchObject({
      status: 200,
    })
  })

  it('leaves a scrypt row alone', async () => {
    const before = await prisma.user.findUnique({
      where: { email: EMAIL },
      select: { passwordHash: true },
    })

    expect(await login({ email: EMAIL, password: PASSWORD })).toMatchObject({
      status: 200,
    })

    const after = await prisma.user.findUnique({
      where: { email: EMAIL },
      select: { passwordHash: true },
    })

    expect(after?.passwordHash).toBe(before?.passwordHash)
  })
})

describe('GET /api/auth/me', () => {
  /**
   * 200 with a null user rather than a 401. Not being signed in is the ordinary state of the
   * front page, and treating it as an error puts a red line in every visitor's console.
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

    // The row is gone, so the cookie is worthless even to somebody who kept a copy of it.
    // Clearing the browser's cookie alone wouldn't be signing out.
    const after = await app.request('/api/auth/me', { headers: { cookie } })
    expect(await after.json()).toEqual({ user: null })
  })

  /**
   * Signing out has to work from a session the server has already forgotten, or a stale cookie
   * is a browser that can never get back to a clean state.
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
    // Cleared then and there rather than left to the sweep: the browser is here, and clearing
    // it is the difference between signing in again and wondering why nothing happens.
    expect(response.headers.get('set-cookie') ?? '').toContain(
      env.SESSION_COOKIE_NAME,
    )
  })
})

/**
 * Officers are whoever sits on the board on the roles desk. Signing in and loading a page leave
 * that alone and never ask Discord, whatever role somebody carries there.
 */
describe('officer status', () => {
  const roleOf = async (email: string) =>
    (
      await prisma.user.findUnique({
        where: { email },
        select: { role: true },
      })
    )?.role

  it('does not promote somebody who carries the Discord role', async () => {
    const response = await login({ email: WITH_ID_EMAIL, password: PASSWORD })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ user: { role: 'GUEST' } })
    expect(await roleOf(WITH_ID_EMAIL)).toBe('GUEST')
  })

  it('does not stand a sitting officer down when Discord says they lost it', async () => {
    memberRoles.mockResolvedValue({ status: 'ok', roles: [] })

    const cookie = cookieFrom(
      await login({ email: SITTING_EMAIL, password: PASSWORD }),
    )
    const me = await app.request('/api/auth/me', { headers: { cookie } })

    expect(await me.json()).toMatchObject({ user: { role: 'OFFICER' } })
    expect(await roleOf(SITTING_EMAIL)).toBe('OFFICER')
    expect(
      await prisma.officerTerm.count({
        where: { user: { email: SITTING_EMAIL }, endedAt: null },
      }),
    ).toBe(1)
  })

  it('never asks Discord on sign-in or page load', async () => {
    const cookie = cookieFrom(
      await login({ email: WITH_ID_EMAIL, password: PASSWORD }),
    )
    await app.request('/api/auth/me', { headers: { cookie } })

    expect(memberRoles).not.toHaveBeenCalled()
    expect(handleCheck).not.toHaveBeenCalled()
    expect(roleList).not.toHaveBeenCalled()
  })
})

/**
 * The way back in, for somebody who can't sign in.
 *
 * The property worth pinning hardest is the first: an unknown address and a real one must be
 * indistinguishable, or this endpoint is a membership lookup — type an address, learn whether
 * that person is in the club.
 */
describe('password reset', () => {
  const forgot = (email: string) => post('/api/auth/password/forgot', { email })

  /** Stand in for the emailed link: the row a `forgot` would have written. The token is stored as
      a hash and is deliberately never in a response. */
  async function pendingReset(email: string) {
    const { createHash, randomBytes } = await import('node:crypto')
    const token = randomBytes(32).toString('base64url')
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    })

    await prisma.passwordReset.upsert({
      where: { userId: user.id },
      update: {
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + 60_000),
      },
      create: {
        userId: user.id,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + 60_000),
      },
    })

    return { token, userId: user.id }
  }

  /** The thirty-second cooldown is per caller, and this suite is one caller. */
  const clearCooldown = () =>
    prisma.rateLimit.deleteMany({
      where: { key: { startsWith: 'password-reset-burst:' } },
    })

  it('answers the same way for an address that has no account', async () => {
    const real = await forgot(EMAIL)
    // Two requests back to back is exactly what the cooldown below exists to stop, and this case
    // is about the answers rather than the pacing.
    await clearCooldown()
    const nobody = await forgot('test-login-nobody@ucf.edu')

    expect(real.status).toBe(202)
    expect(nobody.status).toBe(202)
    expect(await nobody.json()).toEqual(await real.json())
    // And nothing was sent to the address nobody has.
    expect(resetMail).toHaveBeenCalledTimes(1)
  })

  /**
   * A roster entry an officer typed in has no `passwordHash` and can't sign in at all. This is
   * how it becomes a login — the case the login page used to send people to Discord for.
   */
  it('works for a roster entry that has never had a password', async () => {
    expect((await forgot(NO_PASSWORD_EMAIL)).status).toBe(202)
    expect(resetMail).toHaveBeenCalledTimes(1)
  })

  it('sets the password and spends the link', async () => {
    const { token, userId } = await pendingReset(EMAIL)

    const first = await post('/api/auth/password/reset', {
      token,
      password: 'a-completely-new-password',
    })
    expect(first.status).toBe(200)

    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
    expect(await verifyPassword('a-completely-new-password', row.passwordHash ?? '')).toBe(
      true,
    )

    // Expired, unknown and already-spent are one 410 with one sentence.
    const second = await post('/api/auth/password/reset', {
      token,
      password: 'another-new-password',
    })
    expect(second.status).toBe(410)
  })

  /**
   * Every session, with no exception. If the reason for the reset is that somebody else got in,
   * leaving that somebody signed in is the one outcome the whole flow exists to prevent.
   */
  it('ends every session the account had', async () => {
    const { token, userId } = await pendingReset(EMAIL)
    const existing = await createSession(userId)

    await post('/api/auth/password/reset', {
      token,
      password: 'a-completely-new-password',
    })

    const stale = await app.request('/api/auth/me', {
      headers: { cookie: `${env.SESSION_COOKIE_NAME}=${existing.token}` },
    })
    expect(await stale.json()).toEqual({ user: null })
  })

  it('holds the length rule at the point the password is set', async () => {
    const { token } = await pendingReset(EMAIL)

    expect(
      (await post('/api/auth/password/reset', { token, password: 'short' })).status,
    ).toBe(400)
  })

  /**
   * The five-in-ten-minutes budget says nothing about shape: all five can be spent in the same
   * second, at five different addresses, which is five people opening an inbox to a link they
   * didn't ask for. This is the floor under it.
   *
   * The same address twice, deliberately. The per-address budget allows three, so a 429 on the
   * second can only be the cooldown — and the first request proves there was mail on the other
   * end of the one that was refused.
   */
  it('makes a caller wait half a minute before asking again', async () => {
    expect((await forgot(EMAIL)).status).toBe(202)
    expect(resetMail).toHaveBeenCalledTimes(1)

    const again = await forgot(EMAIL)
    expect(again.status).toBe(429)
    expect(Number(again.headers.get('Retry-After'))).toBeLessThanOrEqual(30)
    expect((await again.json()) as { error: string }).toMatchObject({
      error: expect.stringMatching(/half a minute/i),
    })

    // The refusal is the whole point: no second link went out.
    expect(resetMail).toHaveBeenCalledTimes(1)

    await clearCooldown()
    expect((await forgot(EMAIL)).status).toBe(202)
  })

  /**
   * And deliberately *not* on the endpoint that spends the token. That one
   * mails nobody, and it can refuse the password for being too short — a
   * thirty-second wait between attempts at your own new password is a
   * punishment for typing, with no spam on the other end to prevent.
   */
  it('leaves setting the password itself free to retry', async () => {
    const { token } = await pendingReset(EMAIL)

    const first = await post('/api/auth/password/reset', { token, password: 'short' })
    const second = await post('/api/auth/password/reset', { token, password: 'short' })

    expect(first.status).toBe(400)
    expect(second.status).toBe(400)
  })

  it('answers 410 for a link that has expired', async () => {
    const { createHash, randomBytes } = await import('node:crypto')
    const token = randomBytes(32).toString('base64url')
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: EMAIL },
      select: { id: true },
    })

    await prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() - 1_000),
      },
    })

    expect(
      (await post('/api/auth/password/reset', { token, password: 'a-long-new-password' }))
        .status,
    ).toBe(410)
  })
})
