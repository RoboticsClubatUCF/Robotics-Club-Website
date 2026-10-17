import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.js'
import { prisma } from '../../core/db.js'
import { checkDiscordHandle } from '../../discord/discord.js'
import { env } from '../../core/env.js'
import { sendEmailChange } from '../../email/mail.js'
import { hashPassword, verifyPassword } from '../../auth/password.js'
import { createSession } from '../../auth/session.js'

/**
 * Managing your own account, against the live database.
 *
 * The properties worth pinning are the ones invisible from the site and expensive to get wrong:
 *
 *   - the Discord field doesn't call somebody's own handle taken, which is the one thing that
 *     separates this check from signup's;
 *   - changing a password ends the other sessions and not this one;
 *   - an email doesn't move until the link is followed, and the link works exactly once;
 *   - deleting refuses while the club is owed a thing, and takes the stored photo with it.
 */

/**
 * `../discord.js` is mocked outright, not optionally. Two routes here reach
 * `pushRoles`/`stripManagedRoles`, which write roles in the club's real Discord server — the dev
 * `.env` carries a live bot token. The Discord answer is keyed on the handle rather than flat:
 * the confirmed id is written back to the row, so a stub answering "connected" to anything would
 * hand this suite's invented snowflake to whoever else is in the database.
 */
vi.mock('../../discord/discord.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../discord/discord.js')>()),
  checkDiscordHandle: vi.fn(),
  guildMemberRoles: vi.fn().mockResolvedValue({ status: 'unchecked' }),
  guildRoles: vi.fn().mockResolvedValue({ status: 'unavailable' }),
  guildRoster: vi.fn().mockResolvedValue({ status: 'unavailable' }),
  addGuildRole: vi.fn().mockResolvedValue({ status: 'unavailable' }),
  removeGuildRole: vi.fn().mockResolvedValue({ status: 'unavailable' }),
}))

/**
 * **Postmark is configured in the development `.env`**, so the email-change
 * route would otherwise make a real send to a fixture address on every run.
 * `signup.test.ts` mocks this file for exactly the same reason: a test suite
 * must never send mail.
 */
vi.mock('../../email/mail.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../email/mail.js')>()),
  sendEmailChange: vi.fn(),
}))

const handleCheck = vi.mocked(checkDiscordHandle)
const mail = vi.mocked(sendEmailChange)

const PREFIX = 'test-account-'
const EMAIL = `${PREFIX}me@ucf.edu`
const OTHER_EMAIL = `${PREFIX}other@ucf.edu`
const NEW_EMAIL = `${PREFIX}moved@ucf.edu`
const PASSWORD = 'a-long-enough-password'

/**
 * Invented and namespaced: `discordUsername` is unique against a database of real people, and
 * the confirmed id is written back to the row.
 *
 * Underscores rather than the suite's own hyphenated prefix, because a Discord handle is
 * `[a-z0-9._]` and a hyphen makes `isHandleShaped` refuse it — which comes back as `not_found`
 * and looks like the check failing rather than the fixture being illegal.
 */
const MY_HANDLE = 'test_account_mine'
const OTHER_HANDLE = 'test_account_theirs'
const MY_SNOWFLAKE = '666666666666666666'

/** Everything this suite creates, so nothing is ever selected by shape. */
const EMAILS = [EMAIL, OTHER_EMAIL, NEW_EMAIL]

/**
 * Pinned far future, so `demoteIfLapsed` returns before it reads UCF's
 * calendar. Nothing here is dues-gated, but session resolution runs on every
 * one of these requests and a fixture whose date has passed would make the
 * suite's answers depend on the week it is run in.
 */
const PAID_THROUGH = new Date('2035-06-01T00:00:00.000Z')

let myId = ''
let otherId = ''
let cookie = ''

const json = (
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) =>
  app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', cookie, ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const post = (path: string, body?: unknown) => json('POST', path, body)

const pngBytes = () =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

// `Uint8Array<ArrayBuffer>` rather than a bare one: the default parameter
// admits `SharedArrayBuffer`, which `File` will not take.
function uploadPhoto(
  bytes: Uint8Array<ArrayBuffer> = pngBytes(),
  framing?: Record<string, string>,
) {
  const form = new FormData()
  // Prefixed, because `clearRows` finds stored files by `originalName` and nothing else can:
  // `StoredFile.createdById` is `SetNull`, so deleting the fixture's user leaves the row behind.
  // The cleanup was always written for a prefixed name; the fixture wasn't, and six 11-byte
  // `face.png` rows per run had been collecting in the club's development database.
  form.append('file', new File([bytes], `${PREFIX}face.png`, { type: 'image/png' }))
  // As the browser sends it: framed before the upload, so the numbers ride in
  // the same body as the picture rather than following it.
  for (const [field, value] of Object.entries(framing ?? {})) {
    form.append(field, value)
  }

  return app.request('/api/account/photo', {
    method: 'POST',
    body: form,
    headers: { cookie },
  })
}

/**
 * The limiter's counters live in Postgres and outlive the process, so without
 * this a second run inside the window fails for reasons that have nothing to do
 * with the code. Every scope this suite can reach.
 */
const clearWindows = () =>
  prisma.rateLimit.deleteMany({
    where: {
      OR: [
        { key: { startsWith: 'account:' } },
        { key: { startsWith: 'account-check:' } },
        { key: { startsWith: 'account-upload:' } },
      ],
    },
  })

const clearRows = async () => {
  // `OfficerTerm.userId` is `SetNull`, so deleting the people first would leave
  // orphaned rows on the *public* archive. Terms before their holders.
  await prisma.officerTerm.deleteMany({
    where: { user: { email: { in: EMAILS } } },
  })
  await prisma.equipment.deleteMany({ where: { name: { startsWith: PREFIX } } })
  // The lead-title case's project; its memberships go with it.
  await prisma.project.deleteMany({ where: { slug: { startsWith: PREFIX } } })
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } })
  await prisma.storedFile.deleteMany({
    where: { originalName: { startsWith: PREFIX } },
  })
}

beforeEach(async () => {
  await clearWindows()
  await clearRows()

  handleCheck.mockReset()
  mail.mockReset()
  mail.mockResolvedValue(true)
  // The safe default: nothing was asked and nothing is known, so no id is
  // written anywhere. A case wanting a real answer says which handle.
  handleCheck.mockResolvedValue({ status: 'unchecked' })

  const passwordHash = await hashPassword(PASSWORD)

  const me = await prisma.user.create({
    data: {
      fullName: 'Test Account',
      email: EMAIL,
      passwordHash,
      discordUsername: MY_HANDLE,
      role: 'MEMBER',
      duesPaidThrough: PAID_THROUGH,
    },
    select: { id: true },
  })

  const other = await prisma.user.create({
    data: {
      fullName: 'Test Other',
      email: OTHER_EMAIL,
      passwordHash,
      discordUsername: OTHER_HANDLE,
      role: 'MEMBER',
      duesPaidThrough: PAID_THROUGH,
    },
    select: { id: true },
  })

  myId = me.id
  otherId = other.id
  // The cookie name is configuration, so it is read rather than assumed.
  cookie = `${env.SESSION_COOKIE_NAME}=${(await createSession(myId)).token}`
})

afterAll(async () => {
  await clearRows()
  await clearWindows()
})

describe('GET /api/account', () => {
  it('answers with the profile and never with a password hash', async () => {
    const response = await app.request('/api/account', { headers: { cookie } })
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body.email).toBe(EMAIL)
    expect(body.discordUsername).toBe(MY_HANDLE)
    // The fact, not the hash. Nothing anywhere returns the hash itself.
    expect(body.passwordSet).toBe(true)
    expect(JSON.stringify(body)).not.toContain('scrypt$')
    expect(body.pendingEmail).toBeNull()
  })

  it('refuses anybody not signed in', async () => {
    expect((await app.request('/api/account')).status).toBe(401)
  })
})

describe('PATCH /api/account/profile', () => {
  it('saves the name, bio and graduation year', async () => {
    const response = await json('PATCH', '/api/account/profile', {
      fullName: 'Renamed Person',
      bio: 'Builds things.',
      gradYear: 2027,
    })

    expect(response.status).toBe(200)

    const row = await prisma.user.findUniqueOrThrow({ where: { id: myId } })
    expect(row.fullName).toBe('Renamed Person')
    expect(row.bio).toBe('Builds things.')
    expect(row.gradYear).toBe(2027)
  })

  /** A cleared bio is null, not `''` — an empty string prints as an empty
      paragraph on the public roster rather than as no bio at all. */
  it('stores a cleared bio as null', async () => {
    await json('PATCH', '/api/account/profile', {
      fullName: 'Test Account',
      bio: '   ',
      gradYear: null,
    })

    const row = await prisma.user.findUniqueOrThrow({ where: { id: myId } })
    expect(row.bio).toBeNull()
    expect(row.gradYear).toBeNull()
  })

  it('saves a title, and stores a cleared one as null', async () => {
    const profile = { fullName: 'Test Account', bio: null, gradYear: null }

    await json('PATCH', '/api/account/profile', { ...profile, title: ' Chassis Wiring ' })
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: myId } })).title,
    ).toBe('Chassis Wiring')

    await json('PATCH', '/api/account/profile', { ...profile, title: '  ' })
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: myId } })).title,
    ).toBeNull()
  })

  /** A tab still holding the bundle from before the field existed sends no
      `title`, and that must not wipe one an officer or the member set. */
  it('leaves the title alone when the field is not sent', async () => {
    await prisma.user.update({ where: { id: myId }, data: { title: 'Kept' } })

    const response = await json('PATCH', '/api/account/profile', {
      fullName: 'Test Account',
      bio: null,
      gradYear: null,
    })

    expect(response.status).toBe(200)
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: myId } })).title,
    ).toBe('Kept')
  })

  it('refuses a title over 80 characters', async () => {
    const response = await json('PATCH', '/api/account/profile', {
      fullName: 'Test Account',
      bio: null,
      gradYear: null,
      title: 'x'.repeat(81),
    })

    expect(response.status).toBe(400)
  })
})

/**
 * The rules in `membership/titles.ts`, behind the member's own route. What's pinned is
 * that standing is read from the database, not from the words alone: the same "Rover
 * Lead" is refused and then allowed once the row says they lead something.
 */
describe('what a member may call themselves', () => {
  const setTitle = (title: string) =>
    json('PATCH', '/api/account/profile', {
      fullName: 'Test Account',
      bio: null,
      gradYear: null,
      title,
    })

  const storedTitle = async () =>
    (await prisma.user.findUniqueOrThrow({ where: { id: myId } })).title

  it('refuses an obscene title and stores nothing', async () => {
    const response = await setTitle('Sh1t poster')

    expect(response.status).toBe(400)
    expect(await response.text()).toContain('isn’t allowed')
    expect(await storedTitle()).toBeNull()
  })

  it('refuses an office to a member without one', async () => {
    const response = await setTitle('Club President')

    expect(response.status).toBe(400)
    expect(await response.text()).toContain('only for officers')
    expect(await storedTitle()).toBeNull()
  })

  it('lets somebody on the board use an office, seat or role', async () => {
    await prisma.user.update({ where: { id: myId }, data: { role: 'OFFICER' } })

    expect((await setTitle('Treasurer')).status).toBe(200)
    expect(await storedTitle()).toBe('Treasurer')
  })

  /** The advisor's case: on the board as a plain `MEMBER`, through an open term. */
  it('counts an open officer term as standing', async () => {
    await prisma.officerTerm.create({
      data: {
        userId: myId,
        fullName: 'Test Account',
        position: null,
        source: 'MANUAL',
        startedAt: new Date('2035-01-01T00:00:00.000Z'),
      },
    })

    expect((await setTitle('Faculty Advisor')).status).toBe(200)
  })

  it('allows a lead title only to somebody who leads', async () => {
    expect((await setTitle('Rover Lead')).status).toBe(400)

    await prisma.project.create({
      data: {
        slug: `${PREFIX}rover`,
        title: 'Account Rover',
        termYear: 2035,
        termSeason: 'FALL',
        members: { create: { userId: myId, rank: 'TEAM_LEAD' } },
      },
    })

    expect((await setTitle('Rover Lead')).status).toBe(200)
    expect(await storedTitle()).toBe('Rover Lead')
  })

  /**
   * A former officer may name a seat they held, with its years. Their closed Treasurer term
   * ran from August 2022 to May 2023, so 2022 and 2023 are theirs and nothing else is.
   */
  describe('a former officer', () => {
    beforeEach(async () => {
      await prisma.officerTerm.create({
        data: {
          userId: myId,
          fullName: 'Test Account',
          position: 'TREASURER',
          source: 'MANUAL',
          startedAt: new Date('2022-08-20T00:00:00.000Z'),
          endedAt: new Date('2023-05-05T00:00:00.000Z'),
        },
      })
    })

    it.each(['Treasurer, 2022–2023', 'Former Treasurer (2022-23)', 'Officer, 2022'])(
      'may use %j',
      async (title) => {
        expect((await setTitle(title)).status).toBe(200)
        expect(await storedTitle()).toBe(title)
      },
    )

    it.each([
      ['Treasurer', 'no years'],
      ['Treasurer, 2024', 'years they did not hold it'],
      ['Treasurer, 2021–2023', 'a year outside the term'],
      ['President, 2022–2023', 'a seat they never held'],
      ['Chair, 2022', 'an office that names no seat'],
    ])('may not use %j (%s)', async (title) => {
      const response = await setTitle(title)

      expect(response.status).toBe(400)
      expect(await response.text()).toContain('past office')
      expect(await storedTitle()).toBeNull()
    })
  })

  /** A zero-width space draws nothing, so "Le​ad" would show as "Lead" while
      reading as two words. It's stripped before the check and before storage. */
  it('strips invisible characters before checking and storing', async () => {
    expect((await setTitle('Rover Le​ad')).status).toBe(400)

    expect((await setTitle('Wir​ing­')).status).toBe(200)
    expect(await storedTitle()).toBe('Wiring')
  })

  /** Checked on write only. A title from before the rules doesn't stop a bio fix. */
  it('lets a profile save go through around a title from before the rules', async () => {
    await prisma.user.update({ where: { id: myId }, data: { title: 'Club President' } })

    const response = await json('PATCH', '/api/account/profile', {
      fullName: 'Test Account',
      bio: 'Still here.',
      gradYear: null,
    })

    expect(response.status).toBe(200)
    expect(await storedTitle()).toBe('Club President')
  })
})

/**
 * The one field on this page that can be refused on its *content*. What is
 * being pinned is the pair: that a real profile address is stored normalised,
 * and that the refusals in `core/validate.test.ts` still refuse once they are
 * behind a route and a session.
 */
describe('PATCH /api/account/profile-link', () => {
  it('stores the address the server normalised, not the one typed', async () => {
    const response = await json('PATCH', '/api/account/profile-link', {
      profileUrl: 'linkedin.com/in/test-account',
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      profileUrl: 'https://linkedin.com/in/test-account',
    })

    const row = await prisma.user.findUniqueOrThrow({ where: { id: myId } })
    expect(row.profileUrl).toBe('https://linkedin.com/in/test-account')
  })

  /** The panel sends null for an empty box — the same convention every other
      nullable address on this API follows. */
  it('clears it on null', async () => {
    await json('PATCH', '/api/account/profile-link', {
      profileUrl: 'github.com/test-account',
    })
    const response = await json('PATCH', '/api/account/profile-link', {
      profileUrl: null,
    })

    expect(response.status).toBe(200)

    const row = await prisma.user.findUniqueOrThrow({ where: { id: myId } })
    expect(row.profileUrl).toBeNull()
  })

  /**
   * A 400 with a sentence, and nothing written. Both halves matter: this is the
   * only column an ordinary member writes that is printed into an `href` on a
   * public page, so a refusal that still saved would be the whole point missed.
   */
  it('refuses an address the allowlist does not know', async () => {
    const response = await json('PATCH', '/api/account/profile-link', {
      profileUrl: 'https://free-robux.example/claim',
    })

    expect(response.status).toBe(400)

    const row = await prisma.user.findUniqueOrThrow({ where: { id: myId } })
    expect(row.profileUrl).toBeNull()
  })

  it('refuses a javascript: address', async () => {
    const response = await json('PATCH', '/api/account/profile-link', {
      profileUrl: 'javascript:alert(1)',
    })

    expect(response.status).toBe(400)

    const row = await prisma.user.findUniqueOrThrow({ where: { id: myId } })
    expect(row.profileUrl).toBeNull()
  })

  it('refuses anybody not signed in', async () => {
    const response = await app.request('/api/account/profile-link', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileUrl: 'https://github.com/someone' }),
    })

    expect(response.status).toBe(401)
  })
})

describe('POST /api/account/discord-check', () => {
  /**
   * The whole reason this route exists rather than reusing signup's. Signup
   * answers `taken` for a handle *any* account holds, so re-saving your own
   * would be refused by yourself — which reads as the field being broken.
   */
  it('does not call the caller their own handle taken', async () => {
    const response = await post('/api/account/discord-check', {
      discordUsername: MY_HANDLE,
    })

    expect(await response.json()).toEqual({ status: 'unchecked' })
  })

  it('still calls somebody else’s handle taken', async () => {
    const response = await post('/api/account/discord-check', {
      discordUsername: OTHER_HANDLE,
    })

    expect(await response.json()).toEqual({ status: 'taken' })
  })
})

describe('POST /api/account/discord', () => {
  it('stores Discord’s own spelling and the account id', async () => {
    handleCheck.mockImplementation((handle) =>
      Promise.resolve(
        handle === 'test_account_renamed'
          ? {
              status: 'connected',
              username: 'test_account_renamed',
              id: MY_SNOWFLAKE,
              roles: [],
            }
          : { status: 'unchecked' },
      ),
    )

    const response = await post('/api/account/discord', {
      discordUsername: '@Test_Account_Renamed',
    })

    expect(response.status).toBe(200)

    const row = await prisma.user.findUniqueOrThrow({ where: { id: myId } })
    expect(row.discordUsername).toBe('test_account_renamed')
    expect(row.discordId).toBe(MY_SNOWFLAKE)
  })

  /**
   * Refusing costs somebody a minute; accepting writes an unconfirmed handle
   * that looks exactly like a confirmed one from then on — and nearly
   * everything the club builds joins on this string.
   */
  it('refuses rather than guessing when Discord did not answer', async () => {
    handleCheck.mockResolvedValue({ status: 'unavailable' })

    const response = await post('/api/account/discord', {
      discordUsername: 'test_account_whoever',
    })

    expect(response.status).toBe(503)

    const row = await prisma.user.findUniqueOrThrow({ where: { id: myId } })
    expect(row.discordUsername).toBe(MY_HANDLE)
  })

  it('refuses a display name the same way signup does', async () => {
    const response = await post('/api/account/discord', {
      discordUsername: 'Not A Handle',
    })

    expect(response.status).toBe(422)
    // Nothing was asked of Discord: the shape rule answered it here.
    expect(handleCheck).not.toHaveBeenCalled()
  })

  it('answers 409 for a handle another account already holds', async () => {
    const response = await post('/api/account/discord', {
      discordUsername: OTHER_HANDLE,
    })

    expect(response.status).toBe(409)
  })
})

describe('POST /api/account/password', () => {
  it('refuses without the current password', async () => {
    const response = await post('/api/account/password', {
      currentPassword: 'not-the-password',
      newPassword: 'a-brand-new-password',
    })

    expect(response.status).toBe(401)

    const row = await prisma.user.findUniqueOrThrow({ where: { id: myId } })
    expect(await verifyPassword(PASSWORD, row.passwordHash ?? '')).toBe(true)
  })

  /**
   * The property the whole route turns on. A password change that leaves the
   * old one signed in on a laptop in the lab has not done the thing somebody
   * pressed it for — but signing *this* browser out would answer "change my
   * password" with a login form.
   */
  it('ends every other session and keeps this one', async () => {
    const elsewhere = await createSession(myId)

    const response = await post('/api/account/password', {
      currentPassword: PASSWORD,
      newPassword: 'a-brand-new-password',
    })

    expect(response.status).toBe(200)

    // This browser still works.
    expect((await app.request('/api/account', { headers: { cookie } })).status).toBe(200)

    // The other one does not.
    const stale = await app.request('/api/account', {
      headers: { cookie: `${env.SESSION_COOKIE_NAME}=${elsewhere.token}` },
    })
    expect(stale.status).toBe(401)

    const row = await prisma.user.findUniqueOrThrow({ where: { id: myId } })
    expect(await verifyPassword('a-brand-new-password', row.passwordHash ?? '')).toBe(true)
  })

  it('holds the length rule at the point the password is set', async () => {
    const response = await post('/api/account/password', {
      currentPassword: PASSWORD,
      newPassword: 'short',
    })

    expect(response.status).toBe(400)
  })
})

describe('changing the email address', () => {
  it('moves nothing until the link is followed', async () => {
    const asked = await post('/api/account/email', {
      password: PASSWORD,
      email: NEW_EMAIL,
    })

    expect(asked.status).toBe(202)

    // Still the old address, which is the entire point of the two steps.
    const before = await prisma.user.findUniqueOrThrow({ where: { id: myId } })
    expect(before.email).toBe(EMAIL)

    const pending = await prisma.emailChange.findUniqueOrThrow({
      where: { userId: myId },
    })
    expect(pending.newEmail).toBe(NEW_EMAIL)

    // The page says an address is waiting, or "I asked and nothing happened"
    // is what somebody concludes from a form that reset itself.
    const read = await app.request('/api/account', { headers: { cookie } })
    expect(((await read.json()) as { pendingEmail: string }).pendingEmail).toBe(
      NEW_EMAIL,
    )
  })

  it('refuses without the current password', async () => {
    const response = await post('/api/account/email', {
      password: 'not-the-password',
      email: NEW_EMAIL,
    })

    expect(response.status).toBe(401)
    expect(await prisma.emailChange.findUnique({ where: { userId: myId } })).toBeNull()
  })

  it('refuses an address another account already has', async () => {
    const response = await post('/api/account/email', {
      password: PASSWORD,
      email: OTHER_EMAIL,
    })

    expect(response.status).toBe(409)
  })

  /**
   * The token is minted in the route and never returned, so the suite reaches
   * past it the same way the sweeps' suites do — by writing the row it would
   * have written. What is under test is the confirm half.
   */
  it('moves the address once, and the link is then spent', async () => {
    const { createHash, randomBytes } = await import('node:crypto')
    const token = randomBytes(32).toString('base64url')

    await prisma.emailChange.create({
      data: {
        userId: myId,
        newEmail: NEW_EMAIL,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + 60_000),
      },
    })

    const first = await post('/api/account/email/confirm', { token })
    expect(first.status).toBe(200)

    const row = await prisma.user.findUniqueOrThrow({ where: { id: myId } })
    expect(row.email).toBe(NEW_EMAIL)

    // Expired, unknown and already-spent are one 410 with one sentence.
    const second = await post('/api/account/email/confirm', { token })
    expect(second.status).toBe(410)
  })

  it('answers 410 for a link that has expired', async () => {
    const { createHash, randomBytes } = await import('node:crypto')
    const token = randomBytes(32).toString('base64url')

    await prisma.emailChange.create({
      data: {
        userId: myId,
        newEmail: NEW_EMAIL,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() - 1_000),
      },
    })

    expect((await post('/api/account/email/confirm', { token })).status).toBe(410)
  })
})

describe('the profile photo', () => {
  it('stores the upload and points the account at it', async () => {
    const response = await uploadPhoto()
    expect(response.status).toBe(200)

    const row = await prisma.user.findUniqueOrThrow({ where: { id: myId } })
    expect(row.photoUrl).toMatch(/^\/api\/files\//)
  })

  it('refuses a file that is not an image, whatever it is called', async () => {
    const response = await uploadPhoto(new Uint8Array([0x25, 0x50, 0x44, 0x46]))
    expect(response.status).toBe(400)
  })

  /**
   * Framing arrives *with* the picture, because the browser chooses it before
   * anything is uploaded — an avatar replaces, so a mis-picked file has to cost
   * nothing until somebody has looked at it.
   */
  it('reads the framing off the multipart body', async () => {
    const response = await uploadPhoto(pngBytes(), {
      focalX: '20',
      focalY: '80',
      zoom: '2.5',
    })

    expect(response.status).toBe(200)

    const row = await prisma.user.findUniqueOrThrow({ where: { id: myId } })
    expect(row.photoFocalX).toBe(20)
    expect(row.photoFocalY).toBe(80)
    expect(row.photoZoom).toBe(2.5)
  })

  /** The picture is the point of the request; a column default is a correct
      answer for how it is framed. */
  it('ignores framing it cannot parse rather than refusing the photo', async () => {
    const response = await uploadPhoto(pngBytes(), {
      focalX: 'over there',
      zoom: '99',
    })

    expect(response.status).toBe(200)

    const row = await prisma.user.findUniqueOrThrow({ where: { id: myId } })
    expect(row.photoFocalX).toBe(50)
    expect(row.photoZoom).toBe(1)
  })

  /**
   * A new photo must not inherit the crop of the one it replaced: those numbers
   * were chosen against a different picture, and the result is a face half out
   * of frame.
   */
  it('resets the framing when a photo is replaced', async () => {
    await uploadPhoto(pngBytes(), { focalX: '10', focalY: '90', zoom: '3' })
    await uploadPhoto()

    const row = await prisma.user.findUniqueOrThrow({ where: { id: myId } })
    expect(row.photoFocalX).toBe(50)
    expect(row.photoFocalY).toBe(50)
    expect(row.photoZoom).toBe(1)
  })

  /** The other half of framing being metadata: a crop can be changed later
      without the original file, from any device. */
  it('re-frames what is already stored, without touching the bytes', async () => {
    await uploadPhoto()
    const before = await prisma.user.findUniqueOrThrow({ where: { id: myId } })

    const response = await json('PATCH', '/api/account/photo', {
      focalX: 25,
      zoom: 1.5,
    })

    expect(response.status).toBe(200)

    const after = await prisma.user.findUniqueOrThrow({ where: { id: myId } })
    expect(after.photoUrl).toBe(before.photoUrl)
    expect(after.photoFocalX).toBe(25)
    expect(after.photoZoom).toBe(1.5)
    // Applied only when sent, so adjusting zoom alone cannot silently
    // re-centre a photo somebody has already framed.
    expect(after.photoFocalY).toBe(50)
  })

  it('refuses to frame a photo that does not exist', async () => {
    const response = await json('PATCH', '/api/account/photo', { zoom: 2 })
    expect(response.status).toBe(409)
  })

  it('refuses framing outside the range the frame can use', async () => {
    await uploadPhoto()
    expect((await json('PATCH', '/api/account/photo', { zoom: 9 })).status).toBe(400)
    expect((await json('PATCH', '/api/account/photo', { focalX: -1 })).status).toBe(400)
  })

  it('deletes the bytes when the photo is removed', async () => {
    await uploadPhoto()
    const { photoUrl } = await prisma.user.findUniqueOrThrow({ where: { id: myId } })
    const id = (photoUrl ?? '').replace('/api/files/', '')

    expect(await prisma.storedFile.findUnique({ where: { id } })).not.toBeNull()

    const response = await json('DELETE', '/api/account/photo')
    expect(response.status).toBe(200)

    const after = await prisma.user.findUniqueOrThrow({ where: { id: myId } })
    expect(after.photoUrl).toBeNull()
    // Framing goes back to centred with it: what was left behind belongs to a
    // picture that no longer exists, and the next upload would start
    // half-cropped by it.
    expect(after.photoFocalX).toBe(50)
    expect(after.photoZoom).toBe(1)
    // The club does not store files it no longer needs.
    expect(await prisma.storedFile.findUnique({ where: { id } })).toBeNull()
  })
})

describe('DELETE /api/account', () => {
  it('refuses without the password', async () => {
    const response = await json('DELETE', '/api/account', {
      password: 'not-the-password',
    })

    expect(response.status).toBe(401)
    expect(await prisma.user.findUnique({ where: { id: myId } })).not.toBeNull()
  })

  /**
   * The loan row is the only record that a thing left the lab, and it cascades
   * away with the borrower. Deleting here would leave the club short a drill
   * with nothing at all to say who had it.
   */
  it('refuses while club equipment is still out, and names it', async () => {
    const item = await prisma.equipment.create({
      data: { name: `${PREFIX}oscilloscope`, quantity: 1, maxLoanDays: 7 },
      select: { id: true },
    })

    await prisma.equipmentLoan.create({
      data: { equipmentId: item.id, userId: myId, status: 'CHECKED_OUT' },
    })

    const response = await json('DELETE', '/api/account', { password: PASSWORD })
    const body = (await response.json()) as { error: string }

    expect(response.status).toBe(409)
    expect(body.error).toContain(`${PREFIX}oscilloscope`)
    expect(await prisma.user.findUnique({ where: { id: myId } })).not.toBeNull()
  })

  /** A seat vacated this way leaves a card on the public page with a null
      account behind it and no end date. Standing down is the board's business. */
  it('refuses while an officer term is still open', async () => {
    await prisma.officerTerm.create({
      data: {
        userId: myId,
        fullName: 'Test Account',
        startedAt: new Date(),
        source: 'MANUAL',
      },
    })

    const response = await json('DELETE', '/api/account', { password: PASSWORD })

    expect(response.status).toBe(409)
    expect(await prisma.user.findUnique({ where: { id: myId } })).not.toBeNull()
  })

  it('deletes the account, its sessions and its stored photo', async () => {
    await uploadPhoto()
    const { photoUrl } = await prisma.user.findUniqueOrThrow({ where: { id: myId } })
    const fileId = (photoUrl ?? '').replace('/api/files/', '')

    const response = await json('DELETE', '/api/account', { password: PASSWORD })
    expect(response.status).toBe(200)

    expect(await prisma.user.findUnique({ where: { id: myId } })).toBeNull()
    expect(await prisma.session.count({ where: { userId: myId } })).toBe(0)
    // `StoredFile.createdById` is SetNull, so without the explicit delete the
    // bytes would sit in Postgres owned by nobody.
    expect(await prisma.storedFile.findUnique({ where: { id: fileId } })).toBeNull()

    // The cookie is this browser's and has to be told.
    expect((await app.request('/api/account', { headers: { cookie } })).status).toBe(401)
  })

  /** Deleting one account is not deleting the club. */
  it('leaves everybody else alone', async () => {
    await json('DELETE', '/api/account', { password: PASSWORD })

    expect(await prisma.user.findUnique({ where: { id: otherId } })).not.toBeNull()
  })
})
