import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { app } from '../../app.js'
import { prisma } from '../../core/db.js'
import {
  followUpInteraction,
  renameChannel,
  verifyInteraction,
} from '../../discord/discord.js'
import { UserRole } from '../../generated/prisma/enums.js'
import { LAB_BUTTON, LAB_CHANNEL_NAME, pendingLabPush } from '../../lab/labStatus.js'

/**
 * The button on the lab sign.
 *
 * **This suite borrows the club's `lab_status` row, exactly as
 * `routes/public/lab.test.ts` does**, and for the same reason: it is a singleton with
 * a fixed id and there is no prefix to hide behind. Two files writing it is
 * only safe because `vitest.config.ts` sets `fileParallelism: false` — they run
 * one after the other, and each puts the row back.
 *
 * **Discord is mocked at the module boundary, and `verifyInteraction` with
 * it.** The signature check is Ed25519 over the raw body, so a suite that
 * wanted to send a *real* signature would have to hold a private key and sign
 * every fixture — which would be testing Node's crypto. It is pinned once, with
 * a real keypair, in `discord.test.ts`; here it is a switch, so these cases can
 * be about what happens *after* a delivery is believed.
 *
 * **The clock is pinned** because one case is about the building being shut,
 * and because the endpoint refuses a delivery on its age — a timestamp header
 * five minutes out of date is a replay. Both instants are in UTC for the reason
 * `lab.test.ts` says.
 */

const stub = vi.hoisted(() => ({
  /** Swapped to null in one describe, to check the fallback onto the site's own
      `role` column for a club that has not handed the board to Discord. */
  officerRole: '444444444444444444' as string | null,
}))

vi.mock('../../discord/discord.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../discord/discord.js')>()),
  labChannelConfigured: true,
  labChannelId: '111111111111111111',
  labMessageId: null,
  interactionsConfigured: true,
  buttonsLive: () => true,
  // A getter rather than a value: `officerRoleId` is a module constant, and
  // this is the only way one case can see a different one from the rest.
  get officerRoleId() {
    return stub.officerRole
  },
  verifyInteraction: vi.fn(),
  followUpInteraction: vi.fn(),
  memberRoleId: '333333333333333333',
  postChannelMessage: vi.fn(),
  editChannelMessage: vi.fn(),
  deleteChannelMessage: vi.fn(),
  renameChannel: vi.fn(),
  findBotMessages: vi.fn(),
  readChannelName: vi.fn(),
}))

const verified = vi.mocked(verifyInteraction)
const followedUp = vi.mocked(followUpInteraction)
const renamed = vi.mocked(renameChannel)

const OFFICER_ROLE = '444444444444444444'
const APP_ID = '555555555555555555'
const PREFIX = 'test-interaction-'

/** 14:00 in Orlando — the building is open. */
const DAYTIME = new Date('2035-06-15T18:00:00Z')
/** 23:00 in Orlando, the same evening. */
const NIGHT = new Date('2035-06-16T03:00:00Z')

/** The club's own row, borrowed for the length of this file. */
const savedRow = await prisma.labStatus.findUnique({ where: { id: 'current' } })

const clearRows = () =>
  prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })

const row = () => prisma.labStatus.findUnique({ where: { id: 'current' } })

let officerId: string

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(DAYTIME)

  stub.officerRole = OFFICER_ROLE

  await clearRows()
  await prisma.labStatus.deleteMany({ where: { id: 'current' } })

  verified.mockReset()
  followedUp.mockReset()
  renamed.mockReset()
  const discord = await import('../../discord/discord.js')
  vi.mocked(discord.editChannelMessage).mockReset()
  vi.mocked(discord.postChannelMessage).mockReset()
  vi.mocked(discord.deleteChannelMessage).mockReset()
  vi.mocked(discord.findBotMessages).mockReset()

  verified.mockReturnValue(true)
  followedUp.mockResolvedValue(undefined)
  renamed.mockResolvedValue({ status: 'done' })

  vi.mocked(discord.editChannelMessage).mockResolvedValue({ status: 'sent' })
  vi.mocked(discord.postChannelMessage).mockResolvedValue({
    status: 'sent',
    messageId: 'msg-1',
  })
  vi.mocked(discord.deleteChannelMessage).mockResolvedValue({ status: 'done' })
  vi.mocked(discord.findBotMessages).mockResolvedValue({ status: 'none' })

  const officer = await prisma.user.create({
    data: {
      fullName: 'Button Officer',
      email: `${PREFIX}officer@ucf.edu`,
      role: UserRole.OFFICER,
      // Underscores, not hyphens: a Discord handle is `[a-z0-9._]` and a
      // hyphenated prefix fails `isHandleShaped`.
      discordUsername: 'test_interaction_officer',
      discordId: '777777777777777777',
    },
  })

  officerId = officer.id
})

afterEach(() => {
  vi.useRealTimers()
})

afterAll(async () => {
  await clearRows()

  if (savedRow) {
    const { id: _id, updatedAt: _updatedAt, ...saved } = savedRow
    await prisma.labStatus.upsert({
      where: { id: 'current' },
      create: { id: 'current', ...saved },
      update: saved,
    })
  } else {
    await prisma.labStatus.deleteMany({ where: { id: 'current' } })
  }
})

interface Press {
  customId?: string
  roles?: string[]
  discordId?: string
  timestamp?: string
  type?: number
}

const press = (options: Press = {}) =>
  app.request('/api/discord/interactions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Signature-Ed25519': 'a'.repeat(128),
      'X-Signature-Timestamp':
        options.timestamp ?? String(Math.floor(Date.now() / 1_000)),
    },
    body: JSON.stringify({
      type: options.type ?? 3,
      id: '888888888888888888',
      token: 'interaction-token',
      application_id: APP_ID,
      data: { custom_id: options.customId ?? LAB_BUTTON.open },
      member: {
        user: {
          id: options.discordId ?? '777777777777777777',
          username: 'test_interaction_officer',
        },
        roles: options.roles ?? [OFFICER_ROLE],
      },
    }),
  })

/**
 * The response goes out before the flip finishes — that is the whole point of
 * the deferred acknowledgement — so a case asserting on what happened *after*
 * has to wait for the tail of the queue and then let the follow-up's own
 * `.then` run.
 */
async function settle(): Promise<void> {
  await pendingLabPush()
  for (let tick = 0; tick < 5; tick += 1) await Promise.resolve()
}

describe('the handshake', () => {
  /** Discord repeats this every so often to check the endpoint is alive.
      Answering anything else eventually gets the URL disabled. */
  it('answers a PING with a PONG', async () => {
    const response = await press({ type: 1 })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ type: 1 })
  })

  /**
   * Discord probes a new endpoint URL with a deliberately invalid signature and
   * will not save it unless the answer is a 401. This is the one refusal here
   * whose status is somebody else's requirement rather than ours.
   */
  it('refuses an unsigned delivery with a 401', async () => {
    verified.mockReturnValue(false)

    expect((await press()).status).toBe(401)
    expect(await row()).toBeNull()
  })

  /** The signature covers the timestamp but says nothing about when. Without an
      age check a press captured off the wire toggles a room for ever. */
  it('refuses a delivery that is too old to be real', async () => {
    const stale = String(Math.floor(Date.now() / 1_000) - 3_600)

    expect((await press({ timestamp: stale })).status).toBe(401)
    expect(await row()).toBeNull()
  })
})

describe('who may press it', () => {
  it('opens the lab for somebody carrying the officer role', async () => {
    const response = await press()

    // 6 is DEFERRED_UPDATE_MESSAGE: acknowledged, and the presser is shown
    // nothing, because the sign changing under their cursor is the answer.
    await expect(response.json()).resolves.toEqual({ type: 6 })

    await settle()

    const after = await row()
    expect(after?.open).toBe(true)
    expect(after?.changedById).toBe(officerId)
    expect(renamed.mock.calls[0]?.[1]).toBe(LAB_CHANNEL_NAME.open)
  })

  /**
   * A private note and not a public one. This is a channel the whole club
   * reads, and "you are not an officer" posted for everybody is a worse thing
   * to have built than an unguarded button.
   */
  it('refuses a member privately, and changes nothing', async () => {
    const response = await press({ roles: [], discordId: '999999999999999999' })

    const body = (await response.json()) as {
      type: number
      data: { content: string; flags: number }
    }

    // 4 is a reply, 64 is ephemeral.
    expect(body.type).toBe(4)
    expect(body.data.flags).toBe(64)
    expect(body.data.content).toContain('Only officers')

    await settle()
    expect(await row()).toBeNull()
    expect(renamed).not.toHaveBeenCalled()
  })

  /**
   * The fallback for a club that has not handed the board to Discord. The
   * account has to be linked by `discordId`, which signup fills in.
   */
  it('falls back to the site’s own role when no officer role is configured', async () => {
    stub.officerRole = null

    await press({ roles: [] })
    await settle()

    expect((await row())?.open).toBe(true)
  })

  it('refuses a linked account that is not an officer on the site either', async () => {
    stub.officerRole = null

    await prisma.user.update({
      where: { id: officerId },
      data: { role: UserRole.MEMBER },
    })

    const response = await press({ roles: [] })
    await expect(response.json()).resolves.toMatchObject({ type: 4 })

    await settle()
    expect(await row()).toBeNull()
  })

  /** An officer by role with no account here still gets to press — the lab is
      the club's, not the website's — and the flip is recorded against nobody. */
  it('lets an officer with no site account press, attributed to nobody', async () => {
    await press({ discordId: '123123123123123123' })
    await settle()

    const after = await row()
    expect(after?.open).toBe(true)
    expect(after?.changedById).toBeNull()
  })

  it('refuses a press with no guild behind it', async () => {
    const response = await app.request('/api/discord/interactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature-Ed25519': 'a'.repeat(128),
        'X-Signature-Timestamp': String(Math.floor(Date.now() / 1_000)),
      },
      body: JSON.stringify({
        type: 3,
        token: 'interaction-token',
        application_id: APP_ID,
        data: { custom_id: LAB_BUTTON.open },
      }),
    })

    await expect(response.json()).resolves.toMatchObject({ type: 4 })
    expect(await row()).toBeNull()
  })

  it('does not recognise a button it did not put there', async () => {
    const response = await press({ customId: 'something:else' })

    await expect(response.json()).resolves.toMatchObject({ type: 4 })
    expect(await row()).toBeNull()
  })
})

describe('what it says back', () => {
  /**
   * The cooldown. Discord allows two channel renames per ten minutes and the
   * rename is what the flip is gated on, so the lab is left exactly as it was —
   * and the one thing that must not happen is the press appearing to do
   * nothing, because that is what gets it pressed four more times.
   */
  it('warns privately when the rename is rate limited, and changes nothing', async () => {
    renamed.mockResolvedValue({ status: 'throttled', retryAfterMs: 240_000 })

    await press()
    await settle()

    expect(await row()).toBeNull()
    expect(followedUp).toHaveBeenCalledTimes(1)

    const [applicationId, token, content] = followedUp.mock.calls[0] ?? []
    expect(applicationId).toBe(APP_ID)
    expect(token).toBe('interaction-token')
    expect(content).toContain('4 minutes')
    expect(content).toContain('renamed twice every ten minutes')
  })

  it('warns privately when Discord refuses the rename outright', async () => {
    renamed.mockResolvedValue({
      status: 'refused',
      reason: 'rename channel: 403 Forbidden',
    })

    await press()
    await settle()

    expect(await row()).toBeNull()
    expect(followedUp.mock.calls[0]?.[2]).toContain('Manage Channels')
  })

  /** Two officers a second apart, or a message that had not been edited yet.
      Worth saying, because the sign not moving otherwise looks like the press
      having failed. */
  it('says so when the lab was already in that state', async () => {
    await press()
    await settle()
    followedUp.mockClear()

    await press()
    await settle()

    expect(followedUp.mock.calls[0]?.[2]).toContain('already open')
  })

  it('says nothing at all when the flip simply worked', async () => {
    await press()
    await settle()

    expect(followedUp).not.toHaveBeenCalled()
  })

  /**
   * Answered without a round trip to Discord, so it fits inside the three
   * seconds as a sentence rather than a deferral. The button on a current sign
   * is greyed overnight; a stale message still carries a live one.
   */
  it('refuses to open the lab overnight, and says why', async () => {
    vi.setSystemTime(NIGHT)

    const response = await press()
    const body = (await response.json()) as {
      type: number
      data: { content: string }
    }

    expect(body.type).toBe(4)
    expect(body.data.content).toContain('The building is shut between 10pm and 8am')

    await settle()
    expect(await row()).toBeNull()
    // Refused before Discord is touched, so no rename is spent on it.
    expect(renamed).not.toHaveBeenCalled()
  })

  /** An officer realising at 22:05 that they left it open is the last person
      this should argue with. */
  it('still lets an officer close it overnight', async () => {
    await press()
    await settle()

    vi.setSystemTime(NIGHT)
    await press({ customId: LAB_BUTTON.close })
    await settle()

    expect((await row())?.open).toBe(false)
  })
})
