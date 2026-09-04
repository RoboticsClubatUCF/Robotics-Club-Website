import { createHash } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.js'
import { prisma } from '../../core/db.js'
import { checkDiscordHandle } from '../../discord/discord.js'
import { env } from '../../core/env.js'
import { sendSignupVerification } from '../../email/mail.js'

/**
 * Signup, against the live database.
 *
 * The flow is two requests with an email in between, and these tests can't read that email — the
 * token is stored as a hash and is deliberately never in a response. So the second half starts
 * the way the link does: by writing a verification row whose token this file chose.
 *
 * The two calls that leave this machine are stubbed, and only those. Everything else runs for
 * real, because a mocked Prisma would only prove the mock works.
 *
 * Postmark, because a test suite must never send mail: once a real token is in `.env`, an
 * unstubbed run posts to Postmark for every test that starts a signup.
 *
 * Discord, because a suite that needs a live guild containing a fake member fails on a Tuesday
 * for no reason. Stubbing it is also what makes the four answers this route has to handle —
 * found, not found, service down, no bot at all — reachable.
 */
vi.mock('../../discord/discord.js', async (importOriginal) => ({
  // Only the network call is replaced. `normaliseHandle` and `isHandleShaped`
  // are pure, the route leans on both, and swapping them for fakes would test
  // the fakes.
  ...(await importOriginal<typeof import('../../discord/discord.js')>()),
  checkDiscordHandle: vi.fn(),
  // Overridden so the officer branch is reachable at all: the real value is
  // null unless somebody sets `DISCORD_OFFICER_ROLE_ID`, which is how this
  // ships. A literal because a `vi.mock` factory is hoisted above every import
  // and cannot read a `const` from this module.
  officerRoleId: '267371948953042945',
}))

vi.mock('../../email/mail.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../email/mail.js')>()),
  sendSignupVerification: vi.fn(),
}))

const discord = vi.mocked(checkDiscordHandle)
const mail = vi.mocked(sendSignupVerification)

const EMAIL = 'test-signup@ucf.edu'
const HANDLE = 'test_signup_handle'
/** Discord's own id for that handle — a snowflake, so digits only. */
const DISCORD_ID = '135792468135792468'

const CONNECTED = {
  status: 'connected',
  username: HANDLE,
  id: DISCORD_ID,
  // Empty, and stated rather than left off: `roles` decides whether a signup
  // lands as an officer, so a stub that omitted it would be claiming something
  // it had not thought about.
  roles: [] as string[],
} as const

const account = {
  firstName: 'Test',
  lastName: 'Signup',
  password: 'a-long-enough-password',
  discordUsername: HANDLE,
  acknowledgementAccepted: true,
}

function post(path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const start = (body: unknown) => post('/api/signup/start', body)
const verify = (body: unknown) => post('/api/signup/verify', body)
const complete = (body: unknown) => post('/api/signup/complete', body)
const discordCheck = (body: unknown) => post('/api/signup/discord-check', body)

const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex')

/**
 * Stand in for the emailed link: the row a `start` would have written, with a
 * token this file knows. `minutesLeft` goes negative for an expired one.
 */
async function pendingLink(token: string, minutesLeft = 60) {
  const row = {
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + minutesLeft * 60_000),
  }

  await prisma.signupVerification.upsert({
    where: { email: EMAIL },
    update: { ...row, verifiedAt: null },
    create: { email: EMAIL, ...row },
  })
}

/**
 * Every scope, every time. The counters live in Postgres, so they outlive the process — without
 * this, a second run inside the window fails for reasons that have nothing to do with the code.
 *
 * Four of them now, and the last two bite hardest. `signup-burst:` is a thirty-second floor
 * between confirmation emails and `signup-address:` is three per address per window, so a suite
 * that walks `/start` more than once fails on the second call and reads as the route being
 * broken.
 */
const clearWindows = () =>
  prisma.rateLimit.deleteMany({
    where: {
      OR: [
        { key: { startsWith: 'signup:' } },
        { key: { startsWith: 'signup-check:' } },
        { key: { startsWith: 'signup-burst:' } },
        { key: { startsWith: 'signup-address:' } },
      ],
    },
  })

/**
 * The thirty-second floor between confirmation emails is per caller, and this
 * suite is one caller. Cleared rather than waited out, the same way
 * `auth.test.ts` handles the reset route's identical window.
 */
const clearCooldown = () =>
  prisma.rateLimit.deleteMany({
    where: { key: { startsWith: 'signup-burst:' } },
  })

const clearRows = async () => {
  await prisma.user.deleteMany({
    where: { OR: [{ email: EMAIL }, { discordUsername: HANDLE }] },
  })
  await prisma.signupVerification.deleteMany({ where: { email: EMAIL } })
}

beforeEach(async () => {
  await clearWindows()
  await clearRows()

  // The handle is real and in the club's server, and the link goes out, unless
  // a test says otherwise.
  discord.mockReset()
  discord.mockResolvedValue(CONNECTED)
  mail.mockReset()
  mail.mockResolvedValue(true)
})

afterAll(async () => {
  await clearWindows()
  await clearRows()
  await prisma.$disconnect()
})

describe('POST /api/signup/start', () => {
  it('records the address and creates nobody an account yet', async () => {
    const response = await start({ email: EMAIL, acknowledged: true })

    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({ status: 'sent', email: EMAIL })

    const pending = await prisma.signupVerification.findUnique({
      where: { email: EMAIL },
    })
    expect(pending?.expiresAt.getTime()).toBeGreaterThan(Date.now())
    expect(pending?.verifiedAt).toBeNull()

    // The whole point of the first step: nothing about a person is stored until
    // the address is proved.
    expect(await prisma.user.count({ where: { email: EMAIL } })).toBe(0)
  })

  /** Membership is for current UCF students, and this is where that is decided. */
  it.each([
    ['a personal address', 'someone@gmail.com'],
    ['the retired knights domain', 'someone@knights.ucf.edu'],
    ['a lookalike domain', 'someone@ucf.edu.example.com'],
    ['not an address at all', 'someone-at-ucf'],
  ])('turns down %s', async (_case, email) => {
    const response = await start({ email, acknowledged: true })

    expect(response.status).toBe(400)
    expect(await prisma.signupVerification.count({ where: { email } })).toBe(0)
  })

  /**
   * The disclaimer is the only thing the first step is for. A checkbox is a
   * promise the browser makes, so the server asks for it too — posting straight
   * at the endpoint must not be a way around reading it.
   */
  it('will not start a signup that never acknowledged the requirement', async () => {
    const response = await start({ email: EMAIL, acknowledged: false })

    expect(response.status).toBe(400)
    expect(
      await prisma.signupVerification.count({ where: { email: EMAIL } }),
    ).toBe(0)
  })

  it('normalises the address, so one inbox cannot become two accounts', async () => {
    const response = await start({
      email: '  TEST-Signup@UCF.edu ',
      acknowledged: true,
    })

    expect(response.status).toBe(202)
    expect(
      await prisma.signupVerification.count({ where: { email: EMAIL } }),
    ).toBe(1)
  })

  /**
   * Asking again is the documented way out of a link that never arrived, so it
   * has to replace the pending signup rather than leave two live links — and
   * the newest has to be the one that works.
   */
  it('replaces the pending link rather than stacking a second one up', async () => {
    await pendingLink('first-token')

    expect((await start({ email: EMAIL, acknowledged: true })).status).toBe(202)

    expect(
      await prisma.signupVerification.count({ where: { email: EMAIL } }),
    ).toBe(1)
    expect((await verify({ token: 'first-token' })).status).toBe(410)
  })

  /**
   * The link is the flow, not a notification on top of a stored row — the whole difference
   * between this and the contact form. Reporting success for an email that failed to send leaves
   * somebody waiting on mail that was never going to arrive.
   */
  it('does not claim to have sent a link that Postmark refused', async () => {
    mail.mockRejectedValue(new Error('inactive recipient'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await start({ email: EMAIL, acknowledged: true })

    expect(response.status).toBe(502)
    expect(await prisma.user.count({ where: { email: EMAIL } })).toBe(0)
    consoleError.mockRestore()
  })

  /**
   * No Postmark account, which is the normal state of a fresh checkout. Outside production the
   * link goes to the API's log so the flow can still be walked end to end — but never into the
   * response, since a token handed back to the caller proves nothing about the address.
   */
  it('carries on without a mailer outside production, and says nothing secret', async () => {
    mail.mockResolvedValue(false)
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})

    const response = await start({ email: EMAIL, acknowledged: true })
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(202)
    expect(Object.keys(body).sort()).toEqual([
      'email',
      'expiresInMinutes',
      'status',
    ])

    const pending = await prisma.signupVerification.findUnique({
      where: { email: EMAIL },
    })
    expect(JSON.stringify(body)).not.toContain(pending?.tokenHash)

    consoleLog.mockRestore()
  })

  it('refuses an address that already has an account', async () => {
    await prisma.user.create({
      data: { fullName: 'Already Here', email: EMAIL },
    })

    const response = await start({ email: EMAIL, acknowledged: true })

    expect(response.status).toBe(409)
    expect(
      await prisma.signupVerification.count({ where: { email: EMAIL } }),
    ).toBe(0)
  })

  it('stops accepting once the window is used up', async () => {
    for (let attempt = 0; attempt < env.RATE_LIMIT_MAX; attempt++) {
      // The burst floor is a second window on the same caller and would refuse
      // the *second* attempt on its own. This case is about the ten-minute
      // allowance underneath it, so the floor is stepped over each time.
      await clearCooldown()
      const response = await start({ email: 'nope', acknowledged: true })
      expect(response.status, `attempt ${attempt + 1}`).toBe(400)
    }

    await clearCooldown()
    const blocked = await start({ email: EMAIL, acknowledged: true })
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('Retry-After')).toBeTruthy()
  })

  /**
   * The floor under that allowance, and why it isn't redundant: all five of a ten-minute budget
   * can be spent in the same second at five different `@ucf.edu` addresses, which is five
   * students opening an inbox to a link they never asked for.
   *
   * The same address twice on purpose. The per-address budget allows three, so a 429 on the
   * second can only be the cooldown.
   */
  it('makes a caller wait half a minute before asking again', async () => {
    expect((await start({ email: EMAIL, acknowledged: true })).status).toBe(202)
    expect(mail).toHaveBeenCalledTimes(1)

    const again = await start({ email: EMAIL, acknowledged: true })
    expect(again.status).toBe(429)
    expect(Number(again.headers.get('Retry-After'))).toBeLessThanOrEqual(30)
    expect((await again.json()) as { error: string }).toMatchObject({
      error: expect.stringMatching(/half a minute/i),
    })

    // The refusal is the whole point: no second link went out.
    expect(mail).toHaveBeenCalledTimes(1)

    await clearCooldown()
    expect((await start({ email: EMAIL, acknowledged: true })).status).toBe(202)
  })

  /**
   * And the budget keyed on the address rather than the caller. A per-caller
   * limit alone lets a botnet mail one student a link all afternoon from a
   * different address every time; this is what a script changing IP cannot get
   * away from.
   */
  it('will not keep mailing one address however many callers ask', async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await clearCooldown()
      const response = await start({ email: EMAIL, acknowledged: true })
      expect(response.status, `attempt ${attempt + 1}`).toBe(202)
    }

    await clearCooldown()
    const blocked = await start({ email: EMAIL, acknowledged: true })

    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('Retry-After')).toBeTruthy()
    // Three links, and the fourth request sent nothing.
    expect(mail).toHaveBeenCalledTimes(3)
  })
})

describe('POST /api/signup/verify', () => {
  it('confirms the address and says which one it is', async () => {
    await pendingLink('good-token')

    const response = await verify({ token: 'good-token' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ email: EMAIL })
    expect(
      (await prisma.signupVerification.findUnique({ where: { email: EMAIL } }))
        ?.verifiedAt,
    ).not.toBeNull()
  })

  /**
   * Mail apps prefetch links and people reload pages. Neither may move the
   * timestamp, or it stops recording when the address was actually proved.
   */
  it('keeps the first confirmation time when the link is followed twice', async () => {
    await pendingLink('good-token')
    await verify({ token: 'good-token' })

    const first = (
      await prisma.signupVerification.findUnique({ where: { email: EMAIL } })
    )?.verifiedAt

    expect((await verify({ token: 'good-token' })).status).toBe(200)
    expect(
      (await prisma.signupVerification.findUnique({ where: { email: EMAIL } }))
        ?.verifiedAt,
    ).toEqual(first)
  })

  /**
   * Expired, unknown and already-spent are one answer with one sentence. They
   * are the same thing from where the visitor is standing, and telling them
   * apart would confirm to anyone guessing which tokens exist.
   */
  it.each([
    ['an unknown token', 'never-issued'],
    ['an expired one', 'expired-token'],
  ])('turns down %s with the same answer', async (_case, token) => {
    await pendingLink('expired-token', -1)

    const response = await verify({ token })

    expect(response.status).toBe(410)
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('expired'),
    })
  })
})

describe('POST /api/signup/complete', () => {
  const finish = async (over: Record<string, unknown> = {}) => {
    await pendingLink('good-token')
    return complete({ token: 'good-token', ...account, ...over })
  }

  it('creates the account and spends the link', async () => {
    const response = await finish()
    expect(response.status).toBe(201)

    const body = (await response.json()) as { id: string; status: string }
    expect(body.status).toBe('created')

    const user = await prisma.user.findUnique({ where: { id: body.id } })
    expect(user).toMatchObject({
      fullName: 'Test Signup',
      email: EMAIL,
      discordUsername: HANDLE,
      // The snowflake as well as the handle. A member who renames themselves
      // on Discord is still reachable by this, and it is what the bot opens a
      // DM against without searching the guild first.
      discordId: DISCORD_ID,
      // Signing up is not membership: no slug keeps the account off the public
      // roster, and GUEST is what an officer promotes from. `joinedAt` is the
      // date somebody became a member, which is not today.
      role: 'GUEST',
      slug: null,
      joinedAt: null,
    })
    expect(user?.passwordHash).toMatch(/^scrypt\$/)
    // The agreement is the reason the box is there. A signup that recorded
    // everything except the acknowledgement leaves the club unable to show
    // anyone ever accepted the lab rules.
    expect(user?.acknowledgementAcceptedAt).toBeInstanceOf(Date)

    // The link goes with the account it created, rather than staying live
    // beside it.
    expect(
      await prisma.signupVerification.count({ where: { email: EMAIL } }),
    ).toBe(0)
  })

  /**
   * The board is appointed in Discord, so somebody who already carries the role when they sign up
   * is an officer from their first sign-in rather than ten minutes later. The answer costs
   * nothing: the guild search this route already makes returns the roles with it.
   *
   * `joinedAt` is stamped for the reason a payment stamps it — an officer is a member by the act
   * of being on the board. The slug still isn't set: publishing a person stays a decision a
   * person makes.
   */
  it('makes an officer of somebody who carries the Discord role', async () => {
    discord.mockResolvedValue({
      ...CONNECTED,
      roles: ['999999999999999999', '267371948953042945'],
    })

    const { id } = (await (await finish()).json()) as { id: string }
    const user = await prisma.user.findUnique({ where: { id } })

    expect(user).toMatchObject({ role: 'OFFICER', slug: null })
    expect(user?.joinedAt).toBeInstanceOf(Date)
  })

  /** Carrying *some* role is not carrying *the* role. */
  it('leaves somebody with other Discord roles a guest', async () => {
    discord.mockResolvedValue({
      ...CONNECTED,
      roles: ['999999999999999999'],
    })

    const { id } = (await (await finish()).json()) as { id: string }
    const user = await prisma.user.findUnique({ where: { id } })

    expect(user).toMatchObject({ role: 'GUEST', joinedAt: null })
  })

  /**
   * The same invariant every public route is held to. This is the route that
   * puts the hash there in the first place, so it is the one worth asserting on.
   */
  it('never hands back the address or the password hash', async () => {
    const body = (await (await finish()).json()) as Record<string, unknown>

    expect(Object.keys(body).sort()).toEqual(['id', 'status'])
    expect(JSON.stringify(body)).not.toContain('scrypt')
  })

  /** Nothing in the body names an address; it can only come from the token. */
  it('takes the address from the link, not from the request', async () => {
    const { id } = (await (await finish()).json()) as { id: string }

    expect((await prisma.user.findUnique({ where: { id } }))?.email).toBe(EMAIL)
  })

  /**
   * Discord's spelling wins over the visitor's. Everything the club builds on
   * top of this joins on the string, so it has to be the one Discord will
   * answer to.
   */
  it('stores the handle as Discord spells it, not as it was typed', async () => {
    discord.mockResolvedValue(CONNECTED)

    const { id } = (await (
      await finish({ discordUsername: `  @${HANDLE.toUpperCase()} ` })
    ).json()) as { id: string }

    expect((await prisma.user.findUnique({ where: { id } }))?.discordUsername).toBe(
      HANDLE,
    )
  })

  /** No bot configured: the handle stands as typed, tidied but unconfirmed. */
  it('accepts the handle unconfirmed when there is no bot to ask', async () => {
    discord.mockResolvedValue({ status: 'unchecked' })

    const { id } = (await (
      await finish({ discordUsername: `@${HANDLE.toUpperCase()}` })
    ).json()) as { id: string }

    const user = await prisma.user.findUnique({ where: { id } })

    expect(user?.discordUsername).toBe(HANDLE)
    // Nothing was asked, so there is no snowflake to have learned. Storing one
    // here would be inventing it, and everything downstream treats a stored id
    // as a confirmed account.
    expect(user?.discordId).toBeNull()
  })

  it('refuses a handle Discord cannot find, in the words the form shows', async () => {
    discord.mockResolvedValue({ status: 'not_found' })

    const response = await finish()

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: 'Cannot find that user.' })
    expect(await prisma.user.count({ where: { email: EMAIL } })).toBe(0)
  })

  /**
   * Discord being unreachable is not evidence about the handle. Refusing costs
   * someone a few minutes; accepting writes an unconfirmed handle that looks
   * exactly like a confirmed one from then on.
   */
  it('refuses rather than guessing when Discord cannot be reached', async () => {
    discord.mockResolvedValue({ status: 'unavailable' })

    const response = await finish()

    expect(response.status).toBe(503)
    expect(await prisma.user.count({ where: { email: EMAIL } })).toBe(0)
  })

  /**
   * The field checked itself while it was being typed, but that answer came
   * back through a browser. This is the value the club's tooling joins on, so
   * the browser does not get to be the one that decides it.
   */
  it('asks Discord again rather than trusting the form', async () => {
    await finish()

    expect(discord).toHaveBeenCalledWith(HANDLE)
  })

  it.each([
    ['a short password', { password: 'short' }],
    ['a missing surname', { lastName: '  ' }],
    ['a display name in the Discord field', { discordUsername: 'Phi Bi' }],
    /**
     * The member acknowledgement, checked here as well as in the form. A checkbox is a promise the
     * browser makes, and posting straight at this endpoint must not be a way past agreeing to the
     * safety rules — the one field on this form that exists for the club's sake.
     */
    ['an unaccepted acknowledgement', { acknowledgementAccepted: false }],
    ['no acknowledgement at all', { acknowledgementAccepted: undefined }],
  ])('refuses %s without creating anything', async (_case, over) => {
    const response = await finish(over)

    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(await prisma.user.count({ where: { email: EMAIL } })).toBe(0)
    // The link survives a rejected attempt: the address was still proved, and
    // making someone request a new one to fix a typo would be its own bug.
    expect(
      await prisma.signupVerification.count({ where: { email: EMAIL } }),
    ).toBe(1)
  })

  it('will not spend the same link twice', async () => {
    expect((await finish()).status).toBe(201)

    const second = await complete({ token: 'good-token', ...account })

    expect(second.status).toBe(410)
    expect(await prisma.user.count({ where: { email: EMAIL } })).toBe(1)
  })

  it('refuses a Discord handle another account already holds', async () => {
    await prisma.user.create({
      data: { fullName: 'Already Here', discordUsername: HANDLE },
    })

    const response = await finish()

    expect(response.status).toBe(409)
    expect(await prisma.user.count({ where: { email: EMAIL } })).toBe(0)
  })

  it('refuses an address that gained an account while the link was open', async () => {
    await pendingLink('good-token')
    await prisma.user.create({
      data: { fullName: 'Already Here', email: EMAIL },
    })

    const response = await complete({ token: 'good-token', ...account })

    expect(response.status).toBe(409)
    expect(await prisma.user.count({ where: { email: EMAIL } })).toBe(1)
  })
})

describe('POST /api/signup/discord-check', () => {
  it('reports the handle connected', async () => {
    const response = await discordCheck({ discordUsername: HANDLE })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(CONNECTED)
  })

  /**
   * Free matters as much as real: the constraint that makes a handle point at
   * one account is only useful if the form says so before the last step.
   */
  it('reports a handle already connected to an account, without asking Discord', async () => {
    await prisma.user.create({
      data: { fullName: 'Already Here', discordUsername: HANDLE },
    })

    const response = await discordCheck({ discordUsername: HANDLE })

    expect(await response.json()).toEqual({ status: 'taken' })
    expect(discord).not.toHaveBeenCalled()
  })

  /**
   * A display name is the mistake this field exists to catch. Discord cannot
   * hold one whatever the bot is configured to do — capitals and spaces are not
   * legal in a handle — so it is answered without a round trip.
   */
  it.each([
    ['a display name with a space', 'Phi Bi'],
    ['punctuation Discord does not allow', 'phibi!'],
    ['a single character', 'p'],
  ])('cannot find %s', async (_case, input) => {
    const response = await discordCheck({ discordUsername: input })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'not_found' })
    expect(discord).not.toHaveBeenCalled()
  })

  it('passes the handle on tidied up, so an @ and capitals still match', async () => {
    await discordCheck({ discordUsername: `  @${HANDLE.toUpperCase()}  ` })

    expect(discord).toHaveBeenCalledWith(HANDLE)
  })

  /** Its own budget: the field re-asks as a typo is corrected. */
  it('allows more checks than writes before it starts refusing', async () => {
    for (let attempt = 0; attempt < env.RATE_LIMIT_MAX + 1; attempt++) {
      const response = await discordCheck({ discordUsername: HANDLE })
      expect(response.status, `attempt ${attempt + 1}`).toBe(200)
    }
  })
})
