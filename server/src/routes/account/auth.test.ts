import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.js'
import { prisma } from '../../core/db.js'
import { checkDiscordHandle, guildMemberRoles, guildRoles } from '../../discord/discord.js'
import { forgetOfficerChecks, forgetRoleCheck } from '../../discord/discordOfficers.js'
import { env } from '../../core/env.js'
import { sendPasswordReset } from '../../email/mail.js'
import { hashPassword, verifyPassword } from '../../auth/password.js'
import { consume } from '../../core/rateLimit.js'
import { createSession } from '../../auth/session.js'

/**
 * Signing in, against the live database.
 *
 * What the suite is actually for is the handful of properties that are easy to
 * lose in a refactor and impossible to notice by using the site:
 *
 *   - every way of failing gives the same answer, so the form cannot be used to
 *     ask whether a given student is a member;
 *   - the session cookie is `httpOnly`, which is what makes a cross-site
 *     scripting bug stop short of stealing sessions;
 *   - nothing in a response carries a password hash;
 *   - and now: signing in follows the club's Discord officer role, promoting
 *     only, so somebody handed the role a minute ago does not wait out a sweep.
 */

/**
 * **This path leaves the process now, and it did not use to.** `/login` and
 * `/auth/me` both call `refreshOfficerStanding`, which asks Discord about one
 * account — on the dev `.env`'s live bot token, against the club's real guild,
 * where the answers are about real people. Everything that could reach it is
 * stubbed.
 *
 * The role id is invented and the sync is forced *on*, because the property
 * under test is what happens when it is configured. `guildMemberRoles` and
 * `checkDiscordHandle` are bare `vi.fn()`s given a default in `beforeEach`, so
 * a test that forgets to say what Discord answered gets "unchecked" — which
 * writes nothing — rather than a real call.
 */
const OFFICER_ROLE = '111111111111111111'

vi.mock('../../discord/discord.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../discord/discord.js')>()),
  officerSyncConfigured: true,
  officerRoleId: '111111111111111111',
  guildMemberRoles: vi.fn(),
  checkDiscordHandle: vi.fn(),
  // Standing somebody down asks this first — see `officerRoleExists`. Unmocked
  // it is a live call to the club's guild, and worse, it *refuses* every
  // demotion, so the half of this suite about losing the role would pass for
  // entirely the wrong reason.
  guildRoles: vi.fn(),
}))

/**
 * **Postmark is configured in the development `.env`**, so an unmocked run of
 * the reset flow makes a real send to a fixture address every time. Same
 * reasoning as `signup.test.ts`: a test suite must never send mail.
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
 * An account as it arrived from the club's previous site: the password is
 * right, but it is stored as bcrypt rather than scrypt.
 *
 * Pinned rather than generated, so this is a fixed cost-12 `$2b$` string of
 * exactly the shape the import carried — 699 of them — and not whatever
 * `bcryptjs` happens to emit today. It hashes `PASSWORD`.
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
        // The reset flow's three, and the address-keyed one survives even a
        // different machine. The `-burst:` window is thirty seconds, which is
        // short enough to expire during a slow suite and long enough to refuse
        // the next test that asks — so it is cleared like the rest rather than
        // waited out.
        { key: { startsWith: 'password-reset:' } },
        { key: { startsWith: 'password-reset-burst:' } },
        { key: { startsWith: 'password-reset-address:' } },
      ],
    },
  })

/**
 * The officer-sync fixtures, and every value on them is invented and
 * namespaced.
 *
 * `discordId` and `discordUsername` are both `@unique` against a database with
 * the club's real members in it, so a snowflake that looked plausible could
 * collide with a real person's account — and the promotion path *writes*
 * `discordId` back. These cannot match anybody: the ids are a repeated digit
 * and the handles carry the suite's prefix.
 */
const WITH_ID_EMAIL = 'test-login-officer@ucf.edu'
const WITH_ID_SNOWFLAKE = '222222222222222222'
const HANDLE_EMAIL = 'test-login-handle@ucf.edu'
const HANDLE = 'test-login-handle'
const HANDLE_SNOWFLAKE = '333333333333333333'
const SITTING_EMAIL = 'test-login-sitting@ucf.edu'
const SITTING_SNOWFLAKE = '444444444444444444'
const ADMIN_EMAIL = 'test-login-admin@ucf.edu'
const ADMIN_SNOWFLAKE = '555555555555555555'

const FIXTURE_EMAILS = [
  EMAIL,
  NO_PASSWORD_EMAIL,
  LEGACY_EMAIL,
  WITH_ID_EMAIL,
  HANDLE_EMAIL,
  SITTING_EMAIL,
  ADMIN_EMAIL,
]

const clearRows = async () => {
  // `OfficerTerm.userId` is `SetNull`, so deleting the people would leave their
  // terms behind as orphaned rows on the public archive. Terms first.
  await prisma.officerTerm.deleteMany({
    where: { user: { email: { in: FIXTURE_EMAILS } } },
  })
  await prisma.user.deleteMany({ where: { email: { in: FIXTURE_EMAILS } } })
}

beforeEach(async () => {
  await clearWindows()
  await clearRows()
  // Module state, so it outlives a test. Without this the second case to ask
  // about one account is answered from the first one's throttle.
  forgetOfficerChecks()
  // Also module state, and cached for ten minutes — without this the second
  // case to ask is answered from the first one's lookup.
  forgetRoleCheck()

  // Reset before the default is set, so a case asserting that Discord was
  // *not* asked is not reading the previous case's calls.
  memberRoles.mockReset()
  handleCheck.mockReset()
  roleList.mockReset()
  resetMail.mockReset()
  resetMail.mockResolvedValue(true)

  // The safe default: nothing was asked, so nothing is promoted. A test that
  // wants a promotion says so.
  memberRoles.mockResolvedValue({ status: 'unchecked' })
  handleCheck.mockResolvedValue({ status: 'unchecked' })
  // The role exists, so a demotion is allowed to proceed. The case that pins
  // the opposite overrides this.
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

  // Written straight in, deliberately. `hashPassword` cannot produce a bcrypt
  // string and must not be able to — the only way one gets into this column is
  // the import, so that is what the fixture does.
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
      // Handle only: the seed, and anything typed in by hand.
      {
        fullName: 'Test Handle',
        email: HANDLE_EMAIL,
        passwordHash,
        discordUsername: HANDLE,
      },
      // Already an officer, for the half this must never do.
      {
        fullName: 'Test Sitting',
        email: SITTING_EMAIL,
        passwordHash,
        discordId: SITTING_SNOWFLAKE,
        role: 'OFFICER',
      },
      {
        fullName: 'Test Admin',
        email: ADMIN_EMAIL,
        passwordHash,
        discordId: ADMIN_SNOWFLAKE,
        role: 'ADMIN',
      },
    ],
  })

  // The sitting officer needs an open term as well as the role: `role` is what
  // they may do and the term is that they are on the board, and after this
  // change the two are written by different halves of the sync. A fixture with
  // only the role is a state the sync itself would never leave behind.
  const sitting = await prisma.user.findUnique({
    where: { email: SITTING_EMAIL },
    select: { id: true, fullName: true },
  })
  await prisma.officerTerm.create({
    data: {
      userId: sitting!.id,
      fullName: sitting!.fullName,
      position: null,
      startedAt: new Date('2035-01-01'),
      source: 'DISCORD',
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

/**
 * The imported accounts, and the one property that decides whether the club can
 * use this site at all: **the password people already have still works.**
 *
 * The failure this guards against is not loud. `verifyPassword` returns `false`
 * for a stored value it cannot parse, so a bcrypt row it could not read would
 * refuse a correct password with the same 401 as a wrong one — 699 people
 * locked out, and nothing anywhere saying why.
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
    // The conversion is worth nothing if the converted row does not open — and
    // this is the half a rehash written from the *hash* rather than the
    // plaintext would fail.
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

/**
 * Following the club's Discord officer role at the moment somebody arrives.
 *
 * The ten-minute sweep in `discordOfficers.ts` is what keeps the board right in
 * general; this is the half that matters to a person, and the asymmetry is the
 * thing to protect. It promotes on the spot and it must never demote — one
 * member's role list cannot tell a board that rotated from a role id somebody
 * mistyped, and a per-user demotion would stand the whole board down one
 * sign-in at a time.
 */
describe('officer role, followed live', () => {
  const roleOf = async (email: string) =>
    (
      await prisma.user.findUnique({
        where: { email },
        select: { role: true },
      })
    )?.role

  /** The open term, or null. This is what "currently on the board" means, and
      it is a different question from `roleOf` above. */
  const openTermOf = async (email: string) =>
    prisma.officerTerm.findFirst({
      where: { user: { email }, endedAt: null },
      select: { id: true, source: true, position: true },
    })

  /** Keyed on the snowflake, never a flat answer — the promotion writes back
      what it is told, so a stub that says yes to everything hands one
      fixture's identity to whoever else is in the database. */
  const carriedBy = (snowflake: string, roles: string[]) => {
    memberRoles.mockImplementation((id: string) =>
      Promise.resolve(
        id === snowflake
          ? { status: 'ok' as const, roles }
          : { status: 'not_found' as const },
      ),
    )
  }

  it('promotes somebody who carries the role, in the sign-in response', async () => {
    carriedBy(WITH_ID_SNOWFLAKE, [OFFICER_ROLE])

    const response = await login({ email: WITH_ID_EMAIL, password: PASSWORD })

    expect(response.status).toBe(200)
    // In the answer, not only in the database: the dashboard draws its rail
    // from exactly this, and a stale role here is a member staring at a page
    // with no officer desks on it.
    expect(await response.json()).toMatchObject({ user: { role: 'OFFICER' } })
    expect(await roleOf(WITH_ID_EMAIL)).toBe('OFFICER')
  })

  it('leaves somebody who does not carry it exactly as they were', async () => {
    carriedBy(WITH_ID_SNOWFLAKE, ['999999999999999999'])

    const response = await login({ email: WITH_ID_EMAIL, password: PASSWORD })

    expect(await response.json()).toMatchObject({ user: { role: 'GUEST' } })
    expect(await roleOf(WITH_ID_EMAIL)).toBe('GUEST')
  })

  /** The other direction, live: the role goes in Discord and the desks go on
      the same request rather than within ten minutes. */
  it('stands a sitting officer down when the role is gone', async () => {
    carriedBy(SITTING_SNOWFLAKE, [])

    const response = await login({ email: SITTING_EMAIL, password: PASSWORD })

    // Back to whatever the dues loop says about them — `standingRole` decides
    // that, not this route. The fixture has never paid, so: GUEST.
    expect(await response.json()).toMatchObject({ user: { role: 'GUEST' } })
    expect(await roleOf(SITTING_EMAIL)).toBe('GUEST')
  })

  /**
   * **The guard the whole live half rests on, and the one this file exists to
   * protect.**
   *
   * From one member's role list, "not an officer" and "the role id in `.env` is
   * a typo, or names a role somebody deleted" are identical — Discord returns
   * neither an error nor a hint for the second. So before anybody is stood
   * down, `officerRoleExists` checks the id against the guild's own role list.
   * Without this, one wrong character in `.env` would empty the board one
   * sign-in at a time, quietly.
   */
  it('refuses to stand anybody down when the role id is not a role in the guild', async () => {
    carriedBy(SITTING_SNOWFLAKE, [])
    // The guild answers, and the configured id is simply not among its roles.
    roleList.mockResolvedValue({
      status: 'ok',
      roles: new Map([['999999999999999999', 'Some Other Role']]),
    })

    const response = await login({ email: SITTING_EMAIL, password: PASSWORD })

    expect(await response.json()).toMatchObject({ user: { role: 'OFFICER' } })
    expect(await roleOf(SITTING_EMAIL)).toBe('OFFICER')
    expect(await openTermOf(SITTING_EMAIL)).not.toBeNull()
  })

  /** Discord not answering is not evidence the role is gone either. */
  it('refuses to stand anybody down when the role list cannot be read', async () => {
    carriedBy(SITTING_SNOWFLAKE, [])
    roleList.mockResolvedValue({ status: 'unavailable', reason: '503' })

    await login({ email: SITTING_EMAIL, password: PASSWORD })

    expect(await roleOf(SITTING_EMAIL)).toBe('OFFICER')
  })

  /**
   * A `MANUAL` term is somebody's deliberate appointment on the roles desk —
   * the faculty advisor sits on the board carrying no Discord role at all — and
   * the sync closing those would stand them down on its first pass.
   */
  it('leaves a hand-appointed term alone however Discord answers', async () => {
    const advisor = await prisma.user.findUnique({
      where: { email: SITTING_EMAIL },
      select: { id: true },
    })
    await prisma.officerTerm.updateMany({
      where: { userId: advisor!.id, endedAt: null },
      data: { source: 'MANUAL' },
    })

    carriedBy(SITTING_SNOWFLAKE, [])
    await login({ email: SITTING_EMAIL, password: PASSWORD })

    expect(await openTermOf(SITTING_EMAIL)).toMatchObject({ source: 'MANUAL' })
  })

  /**
   * **An officer can also be an admin, and this is the case that proves it.**
   *
   * `UserRole` has one slot per person and `ADMIN` sits above `OFFICER`, so the
   * ladder cannot hold both facts at once — which is why officer-hood is a
   * *term* now. An admin carrying the Discord role gains one exactly as anybody
   * else does, and their `role` is never written in either direction, keeping
   * the "a human in Prisma Studio" invariant whole.
   */
  it('gives an admin a term without ever writing their role', async () => {
    carriedBy(ADMIN_SNOWFLAKE, [OFFICER_ROLE])

    const response = await login({ email: ADMIN_EMAIL, password: PASSWORD })

    expect(await response.json()).toMatchObject({ user: { role: 'ADMIN' } })
    expect(await roleOf(ADMIN_EMAIL)).toBe('ADMIN')
    expect(await openTermOf(ADMIN_EMAIL)).not.toBeNull()
  })

  /** The other direction, and the one that would be easy to get wrong: losing
      the role closes an admin's term and still leaves them an admin. */
  it('closes an admin’s term when the role goes, and leaves them an admin', async () => {
    carriedBy(ADMIN_SNOWFLAKE, [OFFICER_ROLE])
    await login({ email: ADMIN_EMAIL, password: PASSWORD })
    expect(await openTermOf(ADMIN_EMAIL)).not.toBeNull()

    carriedBy(ADMIN_SNOWFLAKE, [])
    forgetOfficerChecks()
    await login({ email: ADMIN_EMAIL, password: PASSWORD })

    expect(await roleOf(ADMIN_EMAIL)).toBe('ADMIN')
    expect(await openTermOf(ADMIN_EMAIL)).toBeNull()
  })

  /**
   * A row that predates the signup check has a handle and no snowflake. It goes
   * through the same search signup uses, which answers with the id and the
   * roles together — so the id is backfilled on the way past at no extra call.
   */
  it('resolves a handle-only account and stores the snowflake it found', async () => {
    handleCheck.mockImplementation((handle: string) =>
      Promise.resolve(
        handle.toLowerCase() === HANDLE
          ? {
              status: 'connected' as const,
              username: HANDLE,
              id: HANDLE_SNOWFLAKE,
              roles: [OFFICER_ROLE],
            }
          : { status: 'not_found' as const },
      ),
    )

    await login({ email: HANDLE_EMAIL, password: PASSWORD })

    const user = await prisma.user.findUnique({
      where: { email: HANDLE_EMAIL },
      select: { role: true, discordId: true },
    })

    expect(user?.role).toBe('OFFICER')
    expect(user?.discordId).toBe(HANDLE_SNOWFLAKE)
  })

  /** Discord having a bad minute must cost sign-in nothing. */
  it('signs somebody in normally when Discord cannot be reached', async () => {
    memberRoles.mockResolvedValue({ status: 'unavailable', reason: 'network' })

    const response = await login({ email: WITH_ID_EMAIL, password: PASSWORD })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ user: { role: 'GUEST' } })
    expect(await roleOf(WITH_ID_EMAIL)).toBe('GUEST')
  })

  /**
   * The other half: somebody handed the role while already signed in never
   * posts to `/login` again, and `/auth/me` is the one request every page of
   * theirs makes.
   */
  it('promotes a browser that was already signed in, on the next page load', async () => {
    const cookie = cookieFrom(await login({ email: WITH_ID_EMAIL, password: PASSWORD }))
    expect(await roleOf(WITH_ID_EMAIL)).toBe('GUEST')

    // The role is handed over in Discord a moment later.
    carriedBy(WITH_ID_SNOWFLAKE, [OFFICER_ROLE])
    forgetOfficerChecks()

    const me = await app.request('/api/auth/me', { headers: { cookie } })

    expect(await me.json()).toMatchObject({ user: { role: 'OFFICER' } })
    expect(await roleOf(WITH_ID_EMAIL)).toBe('OFFICER')
  })

  /**
   * `/auth/me` runs on every page load of every signed-in browser. Without the
   * throttle a busy afternoon is one Discord call per navigation, which is a
   * rate limit nobody would connect to the page they were on.
   */
  it('asks Discord once per person, not once per page load', async () => {
    carriedBy(WITH_ID_SNOWFLAKE, ['999999999999999999'])

    const cookie = cookieFrom(await login({ email: WITH_ID_EMAIL, password: PASSWORD }))
    const asked = memberRoles.mock.calls.length

    await app.request('/api/auth/me', { headers: { cookie } })
    await app.request('/api/auth/me', { headers: { cookie } })
    await app.request('/api/auth/me', { headers: { cookie } })

    expect(memberRoles.mock.calls.length).toBe(asked)
  })

  /**
   * A sitting officer used to be skipped without a call, back when this could
   * only promote and they had nothing to gain. They are now exactly the people
   * worth asking about — skipping them is how an ex-officer keeps their desks
   * until the sweep notices — and the throttle is what keeps that affordable.
   */
  it('does ask about a sitting officer, which is what makes demotion live', async () => {
    carriedBy(SITTING_SNOWFLAKE, [OFFICER_ROLE])

    const cookie = cookieFrom(await login({ email: SITTING_EMAIL, password: PASSWORD }))
    memberRoles.mockClear()
    forgetOfficerChecks()

    await app.request('/api/auth/me', { headers: { cookie } })

    expect(memberRoles).toHaveBeenCalled()
  })

  /** An account with no Discord identity at all cannot be looked up, so nothing
      is asked about them however often they reload. */
  it('never asks about somebody it cannot look up', async () => {
    const cookie = cookieFrom(await login({ email: EMAIL, password: PASSWORD }))
    memberRoles.mockClear()
    handleCheck.mockClear()
    forgetOfficerChecks()

    await app.request('/api/auth/me', { headers: { cookie } })

    expect(memberRoles).not.toHaveBeenCalled()
    expect(handleCheck).not.toHaveBeenCalled()
  })
})


/**
 * The way back in, for somebody who cannot sign in.
 *
 * The property worth pinning hardest is the first one: an unknown address and a
 * real one must be indistinguishable, or this endpoint is a membership lookup —
 * type an address, learn whether that person is in the club — which is exactly
 * what the one-answer rule on the form beside it exists to prevent.
 */
describe('password reset', () => {
  const forgot = (email: string) => post('/api/auth/password/forgot', { email })

  /** Stand in for the emailed link: the row a `forgot` would have written. The
      token is stored as a hash and is deliberately never in a response. */
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
    // Two requests back to back is exactly what the cooldown below exists to
    // stop, and this case is about the *answers* rather than the pacing.
    await clearCooldown()
    const nobody = await forgot('test-login-nobody@ucf.edu')

    expect(real.status).toBe(202)
    expect(nobody.status).toBe(202)
    expect(await nobody.json()).toEqual(await real.json())
    // And nothing was sent to the address nobody has.
    expect(resetMail).toHaveBeenCalledTimes(1)
  })

  /**
   * A roster entry an officer typed in has no `passwordHash` and cannot sign
   * in at all. This is how it becomes a login — the case the login page used to
   * send people to Discord for.
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
   * Every session, with no exception. If the reason for the reset is that
   * somebody else got in, leaving that somebody signed in is the one outcome
   * the whole flow exists to prevent.
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
   * The five-in-ten-minutes budget says nothing about shape: all five can be
   * spent in the same second, at five different addresses, which is five people
   * opening an inbox to a link they did not ask for. This is the floor under
   * it.
   *
   * The same address twice, deliberately. The per-address budget allows three,
   * so a 429 on the second can only be the cooldown — and the first request
   * proves there was mail on the other end of the one that was refused.
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
