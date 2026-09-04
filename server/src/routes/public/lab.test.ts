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
  deleteChannelMessage,
  editChannelMessage,
  findBotMessages,
  postChannelMessage,
  readChannelName,
  renameChannel,
} from '../../discord/discord.js'
import { env } from '../../core/env.js'
import { UserRole } from '../../generated/prisma/enums.js'
import {
  BUILDING_CLOSES_AT,
  BUILDING_OPENS_AT,
  LAB_BUTTON,
  LAB_CHANNEL_NAME,
  buildingOpen,
  campusHour,
  labButtons,
  labMessage,
  pendingLabPush,
  reconcileLabStatus,
  signSays,
  sweepLabStatus,
} from '../../lab/labStatus.js'
import { clearCalendarCache } from '../../membership/semester.js'
import { createSession } from '../../auth/session.js'

/**
 * The lab sign, against the live database.
 *
 * This suite writes a row it can't namespace, and it's the only one here that does.
 * `lab_status` is a singleton — one row with a fixed id — so there's no prefix to hide
 * behind. It reads the club's real row first and puts it back in `afterAll`, keeping the
 * window to this file. Nothing else touches that table.
 *
 * Discord is stubbed at the module boundary, and not optionally. The dev `.env` carries a
 * live bot token and a real channel id, so an unstubbed run would post into the club's
 * actual server and rename an actual channel, twice per test. A stray message can be
 * deleted; a channel renamed at 3am by a test run is something a member reads and believes.
 *
 * The clock is pinned, and it has to be, because the lab refuses to open while the building
 * is shut — left on the wall clock, every opening case would fail for anybody running the
 * suite after ten at night. The two instants below are written in UTC on purpose:
 * `new Date('…T14:00:00')` is fourteen hundred in the runner's zone.
 *
 * What this suite is mostly about is the direction of the sync and the two verbs. Discord is
 * the record: a flip the rename won't take doesn't happen, and the sweep reads the sign back
 * and corrects the row against it. And the sign is one message that can nonetheless ping —
 * opening posts a new message and deletes the old one, everything else edits.
 */

/** A `vi.hoisted` holder, so one case can see the buttons switched off — the real
    `buttonsLive` is a function over module state, not a constant. */
const stub = vi.hoisted(() => ({ buttonsLive: true }))

vi.mock('../../discord/discord.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../discord/discord.js')>()),
  // Configured, so the push actually runs and can be asserted on — pointed at
  // an invented channel that exists nowhere.
  labChannelConfigured: true,
  labChannelId: '111111111111111111',
  labMessageId: null,
  // Invented, not the club's. The real one is in the dev `.env`, and a suite that read it
  // would put the actual Members role into the assertions below — which passes here and
  // pings two and a half thousand people the first time one of these stubs is forgotten.
  memberRoleId: '333333333333333333',
  // Buttons are attached only when a press would actually land — the key and an
  // Interactions Endpoint URL confirmed at startup. Stubbed live here, because asserting on
  // the buttons is half of what this file is for.
  interactionsConfigured: true,
  buttonsLive: () => stub.buttonsLive,
  postChannelMessage: vi.fn(),
  editChannelMessage: vi.fn(),
  deleteChannelMessage: vi.fn(),
  renameChannel: vi.fn(),
  findBotMessages: vi.fn(),
  readChannelName: vi.fn(),
}))

const posted = vi.mocked(postChannelMessage)
const edited = vi.mocked(editChannelMessage)
const deleted = vi.mocked(deleteChannelMessage)
const renamed = vi.mocked(renameChannel)
const listed = vi.mocked(findBotMessages)
const named = vi.mocked(readChannelName)

const CHANNEL = '111111111111111111'
const MEMBERS = '333333333333333333'

/** A message of the bot's, as `findBotMessages` hands them back. Buttons on,
    because everything this file posts carries them. */
const sign = (messageId: string, open: boolean, hasComponents = true) => ({
  messageId,
  content: open ? '🟢 **THE LAB IS OPEN**' : '🔴 **THE LAB IS CLOSED**',
  hasComponents,
})
const PREFIX = 'test-lab-'
const email = (name: string) => `${PREFIX}${name}@ucf.edu`

/** Paid up, so the calendar cannot decide in June that these fixtures are
    lapsed and refuse them for a reason the suite is not about. */
const PAID_UP = new Date('2035-12-31T23:59:59')

/** The other gate. Both are needed to reach anything. */
const SURVEYED = new Date('2035-09-01T00:00:00')

/** 14:00 in Orlando — the building is open. */
const DAYTIME = new Date('2035-06-15T18:00:00Z')

/** 23:00 in Orlando, the same evening. */
const NIGHT = new Date('2035-06-16T03:00:00Z')

const clearWindows = () =>
  prisma.rateLimit.deleteMany({ where: { key: { startsWith: 'lab:' } } })

const clearRows = () =>
  prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })

async function cookieFor(userId: string): Promise<string> {
  const { token } = await createSession(userId)
  return `${env.SESSION_COOKIE_NAME}=${token}`
}

/** The club's own row, borrowed for the length of this file. */
const savedRow = await prisma.labStatus.findUnique({ where: { id: 'current' } })

let officerCookie: string
let memberCookie: string
let officerId: string

beforeEach(async () => {
  // `membershipStanding` runs behind `requireOfficer` and reads UCF's calendar. Stubbed to
  // fail so it falls through to the fixed dates: under fake timers a real request's
  // `AbortSignal.timeout` would never fire, and the suite would hang rather than fail.
  clearCalendarCache()
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('nope', { status: 503 }))),
  )
  vi.useFakeTimers()
  vi.setSystemTime(DAYTIME)

  await clearWindows()
  await clearRows()
  await prisma.labStatus.deleteMany({ where: { id: 'current' } })

  stub.buttonsLive = true

  posted.mockReset()
  edited.mockReset()
  deleted.mockReset()
  renamed.mockReset()
  listed.mockReset()
  named.mockReset()
  // Defaults, so a case that forgets to say what Discord did gets a success
  // rather than `undefined` and a crash three lines into the push.
  posted.mockResolvedValue({ status: 'sent', messageId: 'msg-1' })
  edited.mockResolvedValue({ status: 'sent' })
  deleted.mockResolvedValue({ status: 'done' })
  renamed.mockResolvedValue({ status: 'done' })
  // An empty channel by default: the push has to look before it may post, and a listing that
  // answered `undefined` would read as "could not look" and post nothing at all.
  listed.mockResolvedValue({ status: 'none' })
  named.mockResolvedValue({ status: 'unavailable' })

  const [officer, member] = await Promise.all([
    prisma.user.create({
      data: {
        fullName: 'Lab Officer',
        email: email('officer'),
        role: UserRole.OFFICER,
        duesPaidThrough: PAID_UP,
        surveyCompletedAt: SURVEYED,
      },
    }),
    prisma.user.create({
      data: {
        fullName: 'Lab Member',
        email: email('member'),
        role: UserRole.MEMBER,
        duesPaidThrough: PAID_UP,
        surveyCompletedAt: SURVEYED,
      },
    }),
  ])

  officerId = officer.id
  officerCookie = await cookieFor(officer.id)
  memberCookie = await cookieFor(member.id)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  clearCalendarCache()
})

afterAll(async () => {
  await clearRows()

  // Hand the club's lab status back exactly as it was found. A suite that left the sign
  // reading OPEN would be a suite that sent somebody to the building.
  if (savedRow) {
    const { id: _id, updatedAt: _updatedAt, ...row } = savedRow
    await prisma.labStatus.upsert({
      where: { id: 'current' },
      create: { id: 'current', ...row },
      update: row,
    })
  } else {
    await prisma.labStatus.deleteMany({ where: { id: 'current' } })
  }
})

const flip = (open: boolean, cookie: string) =>
  app.request('/api/lab', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
      Origin: env.SITE_URL,
    },
    body: JSON.stringify({ open }),
  })

const read = () => app.request('/api/lab')

const row = () => prisma.labStatus.findUnique({ where: { id: 'current' } })

describe('GET /api/lab', () => {
  it('reads closed when nobody has ever set it, and dates it with nothing', async () => {
    const response = await read()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      open: false,
      changedAt: null,
      buildingOpen: true,
    })
  })

  it('needs no session — the front page is the caller', async () => {
    await flip(true, officerCookie)

    const body = (await (await read()).json()) as { open: boolean }
    expect(body.open).toBe(true)
  })

  /**
   * The registration-order rule in `app.ts`, from the outside. Mounted with the cached half
   * of the API this would carry `s-maxage=300`, and a five-minute-old answer to "is the lab
   * open right now" is the one answer it must never give.
   */
  it('is not served from the five-minute public cache', async () => {
    const cacheControl = (await read()).headers.get('Cache-Control')

    expect(cacheControl).toContain('s-maxage=30')
    expect(cacheControl).not.toContain('s-maxage=300')
  })

  /** No name on it, ever. The club's own channel says who opened the lab; an endpoint anybody
      can read must not publish which named person was in a building at a particular hour. */
  it('never says who flipped it', async () => {
    await flip(true, officerCookie)

    expect(await (await read()).text()).not.toContain('Lab Officer')
  })
})

describe('PATCH /api/lab', () => {
  it('lets an officer open the lab, and records who', async () => {
    const response = await flip(true, officerCookie)
    expect(response.status).toBe(200)

    expect((await row())?.open).toBe(true)
    expect((await row())?.changedById).toBe(officerId)
  })

  it('refuses a member', async () => {
    expect((await flip(true, memberCookie)).status).toBe(403)
    expect(await row()).toBeNull()
  })

  /**
   * The dashboard's switch can't ask for this — its label follows the state — but a second
   * tab, a double submit or a script can. Left to write, it would re-stamp `changedAt`, which
   * reads downstream as a new opening, and spend one of the two renames Discord allows.
   */
  it('does nothing at all when asked for the state it is already in', async () => {
    await flip(true, officerCookie)

    const before = await row()
    posted.mockClear()
    renamed.mockClear()
    edited.mockClear()

    expect((await flip(true, officerCookie)).status).toBe(200)

    expect((await row())?.changedAt).toEqual(before?.changedAt)
    expect(posted).not.toHaveBeenCalled()
    expect(edited).not.toHaveBeenCalled()
    expect(renamed).not.toHaveBeenCalled()
  })

  it('refuses a caller with no session', async () => {
    const response = await app.request('/api/lab', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Origin: env.SITE_URL },
      body: JSON.stringify({ open: true }),
    })

    expect(response.status).toBe(401)
  })
})

/**
 * The rule the whole rewrite turns on. Discord is the record, so the rename is a
 * precondition rather than a consequence: if the channel name won't move, the lab didn't
 * open, and the officer is told which of the two it was.
 */
describe('a flip Discord will not take does not happen', () => {
  it('refuses the flip on a throttled rename, and says how long', async () => {
    renamed.mockResolvedValue({ status: 'throttled', retryAfterMs: 300_000 })

    const response = await flip(true, officerCookie)

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({
      error: expect.stringContaining('5 minutes'),
    })
    // The wait, in the shape everything else on this API uses for "not now".
    expect(response.headers.get('Retry-After')).toBe('300')
  })

  it('leaves the lab exactly as it was when the rename is throttled', async () => {
    await flip(true, officerCookie)
    const before = await row()

    renamed.mockResolvedValue({ status: 'throttled', retryAfterMs: 300_000 })
    edited.mockClear()

    expect((await flip(false, officerCookie)).status).toBe(429)

    const after = await row()
    expect(after?.open).toBe(true)
    expect(after?.changedAt).toEqual(before?.changedAt)
    // And nothing was said in the channel either. A message already edited to CLOSED under a
    // green name is the split this is preventing.
    expect(edited).not.toHaveBeenCalled()
  })

  /** Manage Channels taken away, or a channel id naming nothing. Neither ever starts working
      on its own, so "try again" would be advice that never comes good — the sentence names
      the permission instead. */
  it('refuses the flip when Discord will not rename the channel at all', async () => {
    renamed.mockResolvedValue({ status: 'refused', reason: 'rename channel: 403' })

    const response = await flip(true, officerCookie)

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      error: expect.stringContaining('Manage Channels'),
    })
    expect(await row()).toBeNull()
  })

  /**
   * The asymmetry, and it's deliberate. By the time the message is written the channel has
   * already been renamed, so refusing here would leave the name saying one thing and the row
   * another. The flip stands and the row is marked for the sweep.
   */
  it('still commits when the message fails after the rename landed', async () => {
    edited.mockResolvedValue({ status: 'unavailable', reason: 'network' })
    listed.mockResolvedValue({ status: 'none' })
    posted.mockResolvedValue({ status: 'unavailable', reason: 'network' })

    expect((await flip(true, officerCookie)).status).toBe(200)

    const after = await row()
    expect(after?.open).toBe(true)
    expect(after?.discordSynced).toBe(false)
  })
})

/**
 * One message in the channel, and it still pings.
 *
 * The two requirements that look like they can't both hold: posting notifies and editing
 * never does, so a sign kept up to date for ever reaches nobody, and a sign that posts every
 * evening fills a channel until people mute it. The way through is post new, delete old.
 */
describe('the one message', () => {
  it('posts a new message when the lab opens, and deletes the one before it', async () => {
    // The channel already holds last week's sign, which is the ordinary state.
    await prisma.labStatus.create({
      data: {
        id: 'current',
        open: false,
        discordChannelId: CHANNEL,
        discordMessageId: 'msg-last-week',
      },
    })
    posted.mockResolvedValue({ status: 'sent', messageId: 'msg-tonight' })

    await flip(true, officerCookie)

    expect(posted).toHaveBeenCalledTimes(1)
    expect(posted.mock.calls[0]?.[1]).toContain('THE LAB IS OPEN')
    // One in, one out — the whole point of posting was to leave one message.
    expect(deleted).toHaveBeenCalledWith(CHANNEL, 'msg-last-week')
    expect((await row())?.discordMessageId).toBe('msg-tonight')
  })

  /**
   * The ping, and the reason opening posts at all: an edit notifies nobody, so a message kept
   * up to date for ever would reach @Members once and never again.
   */
  it('pings @Members on the way open', async () => {
    await flip(true, officerCookie)

    expect(posted.mock.calls[0]?.[1]).toContain(`<@&${MEMBERS}>`)
    // Said out loud rather than relying on Discord's default parsing, which would let
    // anything in the body become a mention.
    expect(posted.mock.calls[0]?.[2]?.mentionRoles).toEqual([MEMBERS])
  })

  /**
   * Closing edits, and not only to save a message: a new message marks the channel unread for
   * the whole club, and "the lab shut twenty seconds ago" is an interruption nobody can act on.
   */
  it('edits in place when the lab closes, and pings nobody', async () => {
    await flip(true, officerCookie)
    posted.mockClear()

    await flip(false, officerCookie)

    expect(posted).not.toHaveBeenCalled()
    expect(edited).toHaveBeenCalledTimes(1)
    expect(edited.mock.calls[0]?.[1]).toBe('msg-1')
    expect(edited.mock.calls[0]?.[2]).toContain('THE LAB IS CLOSED')
    // The mention is off the closed sign entirely — on a message an edit delivered, it would
    // look like a notification somebody had missed.
    expect(edited.mock.calls[0]?.[2]).not.toContain('<@&')
  })

  it('renames the channel to match, both ways', async () => {
    await flip(true, officerCookie)
    expect(renamed.mock.calls[0]?.[1]).toBe(LAB_CHANNEL_NAME.open)

    await flip(false, officerCookie)
    expect(renamed.mock.calls[1]?.[1]).toBe(LAB_CHANNEL_NAME.closed)
  })

  /**
   * The failure worth choosing a direction on. A post that doesn't go out took the ping with
   * it and nothing can bring it back — so the sign is put right by an edit instead. An evening
   * nobody was told about is a shame; a sign reading CLOSED over an open lab is worse.
   */
  it('falls back to editing when the announcement will not post', async () => {
    await flip(false, officerCookie)
    posted.mockResolvedValue({ status: 'unavailable', reason: 'network' })
    edited.mockClear()

    expect((await flip(true, officerCookie)).status).toBe(200)

    expect(edited.mock.calls[0]?.[2]).toContain('THE LAB IS OPEN')
    expect((await row())?.open).toBe(true)
  })

  /**
   * The check that makes the rule hold across a restored dump, a row somebody reset, or a
   * `DISCORD_LAB_MESSAGE_ID` nobody filled in. Without it the next push posts a second sign
   * and the channel collects one per incident.
   */
  it('adopts a message already in the channel rather than posting beside it', async () => {
    listed.mockResolvedValue({
      status: 'found',
      messages: [sign('msg-from-before', true)],
    })

    await flip(false, officerCookie)

    expect(posted).not.toHaveBeenCalled()
    expect(edited.mock.calls[0]?.[1]).toBe('msg-from-before')
    expect((await row())?.discordMessageId).toBe('msg-from-before')
  })

  /**
   * "There is nothing of ours here" and "I could not look" arrive at the same place, and only
   * the first is safe to act on. Treating a missing Read Message History as an empty channel
   * is how a channel ends up with forty signs in it.
   */
  it('posts nothing when it could not read the channel', async () => {
    listed.mockResolvedValue({
      status: 'refused',
      reason: 'list channel: 403 Forbidden',
    })

    expect((await flip(false, officerCookie)).status).toBe(200)

    expect(posted).not.toHaveBeenCalled()
    // The flip stands — the rename landed — and the sweep is left to try the
    // message again.
    expect((await row())?.open).toBe(false)
    expect((await row())?.discordSynced).toBe(false)
  })

  /** Deleted by hand, or never ours. The listing is what that answer falls through to, and
      only an empty channel gets a fresh post. */
  it('posts a new one when the stored message has gone and nothing replaces it', async () => {
    await flip(true, officerCookie)

    edited.mockResolvedValue({ status: 'gone' })
    listed.mockResolvedValue({ status: 'none' })
    posted.mockResolvedValue({ status: 'sent', messageId: 'msg-2' })

    await flip(false, officerCookie)

    expect((await row())?.discordMessageId).toBe('msg-2')
    expect((await row())?.discordSynced).toBe(true)
  })

  it('leaves a stale message alone when the channel has been re-pointed', async () => {
    await flip(true, officerCookie)

    // The club made a new channel and pointed the setting at it. The stored id names a message
    // in the old one, and editing it would put the sign back on a board nobody is reading.
    await prisma.labStatus.update({
      where: { id: 'current' },
      data: { discordChannelId: '222222222222222222' },
    })

    edited.mockClear()
    posted.mockClear()

    await flip(false, officerCookie)

    expect(edited).not.toHaveBeenCalled()
    expect(posted).toHaveBeenCalledTimes(1)
  })

  /**
   * The delete after a post can fail, an earlier design can have left a message per opening
   * behind, two instances can both have posted — and none of those heal on their own, because
   * every other path edits. The sweep turns "one message" from an intention into an invariant.
   */
  it('clears strays out of the channel on the sweep, and keeps the sign', async () => {
    await flip(true, officerCookie)

    listed.mockResolvedValue({
      status: 'found',
      messages: [
        sign('msg-1', true),
        sign('msg-older', true),
        sign('msg-oldest', false),
      ],
    })
    named.mockResolvedValue({ status: 'found', name: LAB_CHANNEL_NAME.open })

    await reconcileLabStatus()

    expect(deleted).toHaveBeenCalledWith(CHANNEL, 'msg-older')
    expect(deleted).toHaveBeenCalledWith(CHANNEL, 'msg-oldest')
    // Never the sign itself.
    expect(deleted).not.toHaveBeenCalledWith(CHANNEL, 'msg-1')
  })

  it('deletes nothing when the channel could not be listed', async () => {
    await flip(true, officerCookie)
    deleted.mockClear()

    listed.mockResolvedValue({ status: 'unavailable', reason: 'network' })

    await reconcileLabStatus()

    expect(deleted).not.toHaveBeenCalled()
  })
})

describe('the buttons', () => {
  /** Down through the action row to the one button, since a `MessageComponents` is
      deliberately loosely typed — see the note on it in `discord.ts`. */
  const only = (state: {
    open: boolean
    changedAt: Date | null
    changedBy: string | null
    buildingOpen: boolean
  }) => {
    const rows = labButtons(state) as {
      components: Record<string, unknown>[]
    }[]

    expect(rows).toHaveLength(1)
    return rows[0]!.components[0]!
  }

  it('offers the opposite action, in the matching colour', () => {
    const button = only({
      open: false,
      changedAt: null,
      changedBy: null,
      buildingOpen: true,
    })

    expect(button.custom_id).toBe(LAB_BUTTON.open)
    expect(button.label).toBe('Open the lab')
    // 3 is Discord's green.
    expect(button.style).toBe(3)
    expect(button.disabled).toBe(false)

    const other = only({
      open: true,
      changedAt: null,
      changedBy: null,
      buildingOpen: true,
    })

    expect(other.custom_id).toBe(LAB_BUTTON.close)
    expect(other.label).toBe('Close the lab')
    expect(other.style).toBe(4)
  })

  /** Greyed rather than dropped, for the reason the dashboard's switch is: the control is
      still theirs and simply has nothing to act on until eight. */
  it('greys the open button out overnight', () => {
    expect(
      only({
        open: false,
        changedAt: null,
        changedBy: null,
        buildingOpen: false,
      }).disabled,
    ).toBe(true)
  })

  /**
   * The promise this function makes, and it was untrue for a while: the key alone used to be
   * enough, so filling in `DISCORD_PUBLIC_KEY` and nothing else put a button in the club's
   * channel that answered "This interaction failed" to whoever pressed it.
   */
  it('attaches nothing at all when a press would not land', async () => {
    stub.buttonsLive = false

    expect(
      labButtons({
        open: false,
        changedAt: null,
        changedBy: null,
        buildingOpen: true,
      }),
    ).toEqual([])

    await flip(true, officerCookie)
    expect(posted.mock.calls[0]?.[2]?.components).toEqual([])
  })

  it('hangs them under the message it posts and the one it edits', async () => {
    await flip(true, officerCookie)
    expect(posted.mock.calls[0]?.[2]?.components).toHaveLength(1)

    await flip(false, officerCookie)
    expect(edited.mock.calls[0]?.[3]?.components).toHaveLength(1)
  })
})

/**
 * The other half of "Discord is the record": the sweep reads the sign back and corrects the
 * row against it. A message edited by hand, a write this process lost, a second instance that
 * flipped it — all end with the site agreeing with the channel.
 */
describe('reading the sign back', () => {
  it('reads a headline out of a message', () => {
    expect(signSays('🟢 **THE LAB IS OPEN**\nOpened by Rowan')).toBe(true)
    expect(signSays('🔴 **THE LAB IS CLOSED**')).toBe(false)
    // Not this feature's message. Not a state to adopt.
    expect(signSays('who left the soldering iron on')).toBeNull()
  })

  it('adopts an open sign the site did not know about', async () => {
    await flip(false, officerCookie)

    listed.mockResolvedValue({
      status: 'found',
      messages: [
        {
          messageId: 'msg-1',
          content: '🟢 **THE LAB IS OPEN**',
          hasComponents: true,
        },
      ],
    })
    named.mockResolvedValue({ status: 'found', name: LAB_CHANNEL_NAME.open })

    await expect(reconcileLabStatus()).resolves.toEqual({
      adopted: true,
      open: true,
    })

    const after = await row()
    expect(after?.open).toBe(true)
    // Nobody here pressed anything, so nobody's name goes on it.
    expect(after?.changedById).toBeNull()
  })

  it('leaves the row alone when the sign already agrees', async () => {
    await flip(true, officerCookie)

    listed.mockResolvedValue({
      status: 'found',
      messages: [
        {
          messageId: 'msg-1',
          content: '🟢 **THE LAB IS OPEN**',
          hasComponents: true,
        },
      ],
    })
    named.mockResolvedValue({ status: 'found', name: LAB_CHANNEL_NAME.open })

    const before = await row()
    await expect(reconcileLabStatus()).resolves.toEqual({
      adopted: false,
      open: true,
    })

    expect((await row())?.changedAt).toEqual(before?.changedAt)
  })

  /** A channel somebody renamed by hand, or a name left behind by a throttled push. Noticed
      on the tick rather than at the next flip. */
  it('marks the row unsynced when the channel name has drifted', async () => {
    await flip(true, officerCookie)

    listed.mockResolvedValue({
      status: 'found',
      messages: [
        {
          messageId: 'msg-1',
          content: '🟢 **THE LAB IS OPEN**',
          hasComponents: true,
        },
      ],
    })
    named.mockResolvedValue({ status: 'found', name: 'lab-status-🔴' })

    await reconcileLabStatus()

    expect((await row())?.discordSynced).toBe(false)
  })

  /** The curfew is a fact about a locked door, not a sync direction. It's the one thing that
      overrides the sign. */
  it('will not adopt an open sign while the building is shut', async () => {
    await flip(true, officerCookie)
    vi.setSystemTime(NIGHT)

    listed.mockResolvedValue({
      status: 'found',
      messages: [
        {
          messageId: 'msg-1',
          content: '🟢 **THE LAB IS OPEN**',
          hasComponents: true,
        },
      ],
    })

    await expect(reconcileLabStatus()).resolves.toEqual({
      adopted: false,
      open: true,
    })

    const after = await row()
    expect(after?.open).toBe(false)
    // And the sign is what gets corrected, on the next push.
    expect(after?.discordSynced).toBe(false)
  })

  /**
   * The hole `signAgrees` exists to close. A message edited by hand to OPEN at two in the
   * morning, in a channel somebody also renamed green, agrees with itself perfectly — so a
   * check that only asked whether the name matched the message would leave that sign up all
   * night over a row reading closed.
   */
  it('pushes a correction when a hand-edited sign agrees with itself overnight', async () => {
    await flip(false, officerCookie)
    await prisma.labStatus.update({
      where: { id: 'current' },
      data: { discordSynced: true },
    })

    vi.setSystemTime(NIGHT)
    listed.mockResolvedValue({
      status: 'found',
      messages: [
        {
          messageId: 'msg-1',
          content: '🟢 **THE LAB IS OPEN**',
          hasComponents: true,
        },
      ],
    })
    named.mockResolvedValue({ status: 'found', name: LAB_CHANNEL_NAME.open })

    await reconcileLabStatus()

    const after = await row()
    expect(after?.open).toBe(false)
    expect(after?.discordSynced).toBe(false)
  })

  /**
   * The invisible one. A club fills in `DISCORD_PUBLIC_KEY`, restarts, and the sign's content
   * is already correct — so without this nothing would push and no buttons would appear until
   * somebody happened to flip the lab, which reads as the key not working.
   */
  it('pushes when the sign is right but carries no buttons', async () => {
    await flip(true, officerCookie)
    await prisma.labStatus.update({
      where: { id: 'current' },
      data: { discordSynced: true },
    })

    listed.mockResolvedValue({
      status: 'found',
      messages: [
        {
          messageId: 'msg-1',
          content: '🟢 **THE LAB IS OPEN**',
          hasComponents: false,
        },
      ],
    })
    named.mockResolvedValue({ status: 'found', name: LAB_CHANNEL_NAME.open })

    await reconcileLabStatus()

    expect((await row())?.discordSynced).toBe(false)
  })

  /**
   * The one that actually happened, against the club's real guild.
   *
   * A leftover from the announce-per-opening design was still in the channel saying THE LAB IS
   * CLOSED. The reconcile read it, couldn't tell it from a sign somebody had just corrected,
   * and closed the lab for the whole club while an officer was standing in it.
   *
   * So state is only ever read back from the message the row knows it is keeping. A message
   * found by search is adopted as the sign — its id is learned — but its state is not read.
   */
  it('never lets a message the row did not know about change the lab', async () => {
    await flip(true, officerCookie)

    listed.mockResolvedValue({
      status: 'found',
      messages: [sign('msg-somebody-elses-leftover', false)],
    })
    named.mockResolvedValue({ status: 'found', name: LAB_CHANNEL_NAME.open })

    await expect(reconcileLabStatus()).resolves.toEqual({
      adopted: false,
      open: null,
    })

    const after = await row()
    // The lab is still open. This is the whole test.
    expect(after?.open).toBe(true)
    // The id is learned all the same, and the row is marked for a push that
    // puts the site's own state onto it.
    expect(after?.discordMessageId).toBe('msg-somebody-elses-leftover')
    expect(after?.discordSynced).toBe(false)
  })

  /**
   * And nothing is deleted on that tick either. "Which of these is the sign" had just been
   * guessed at rather than answered, and a tidy run on a guess deletes the club's real
   * announcement — the other half of what went wrong.
   */
  it('deletes nothing on a tick where it could not identify the sign', async () => {
    await flip(true, officerCookie)
    deleted.mockClear()

    listed.mockResolvedValue({
      status: 'found',
      messages: [sign('msg-stray-a', false), sign('msg-stray-b', true)],
    })

    await reconcileLabStatus()

    expect(deleted).not.toHaveBeenCalled()
  })

  it('adopts nothing from a message this feature did not write', async () => {
    await flip(false, officerCookie)

    listed.mockResolvedValue({
      status: 'found',
      messages: [
        {
          messageId: 'msg-1',
          content: 'pizza in the lab',
          hasComponents: true,
        },
      ],
    })

    await expect(reconcileLabStatus()).resolves.toEqual({
      adopted: false,
      open: null,
    })
    expect((await row())?.open).toBe(false)
  })

  it('adopts nothing when Discord cannot be read', async () => {
    await flip(true, officerCookie)

    listed.mockResolvedValue({ status: 'unavailable', reason: 'network' })

    await expect(reconcileLabStatus()).resolves.toEqual({
      adopted: false,
      open: null,
    })
    expect((await row())?.open).toBe(true)
  })

  it('runs on the sweep, so the site catches up within ten minutes', async () => {
    await flip(false, officerCookie)

    listed.mockResolvedValue({
      status: 'found',
      messages: [
        {
          messageId: 'msg-1',
          content: '🟢 **THE LAB IS OPEN**',
          hasComponents: true,
        },
      ],
    })
    named.mockResolvedValue({ status: 'found', name: LAB_CHANNEL_NAME.open })

    await expect(sweepLabStatus()).resolves.toMatchObject({ adopted: true })
    await pendingLabPush()

    expect((await row())?.open).toBe(true)
  })
})

describe('the sweep retries what did not land', () => {
  it('re-pushes a message that failed, and stops once it lands', async () => {
    edited.mockResolvedValue({ status: 'unavailable', reason: 'network' })
    posted.mockResolvedValue({ status: 'unavailable', reason: 'network' })
    await flip(true, officerCookie)
    expect((await row())?.discordSynced).toBe(false)

    // Discord comes back. The sign is read first — it still says the old thing, or nothing —
    // and then the push goes out.
    edited.mockResolvedValue({ status: 'sent' })
    posted.mockResolvedValue({ status: 'sent', messageId: 'msg-1' })
    listed.mockResolvedValue({ status: 'none' })

    await expect(sweepLabStatus()).resolves.toMatchObject({ retried: true })
    await pendingLabPush()

    expect((await row())?.discordSynced).toBe(true)

    // And having landed, it is not pushed a third time.
    await expect(sweepLabStatus()).resolves.toMatchObject({ retried: false })
  })

  /** Nothing to say, so nothing is said. A channel isn't renamed to red on the strength of a
      row that doesn't exist. */
  it('leaves the channel alone when the lab has never been set', async () => {
    await expect(sweepLabStatus()).resolves.toEqual({
      closed: false,
      adopted: false,
      retried: false,
    })

    expect(posted).not.toHaveBeenCalled()
    expect(renamed).not.toHaveBeenCalled()
  })
})

describe('the building shuts at ten', () => {
  /**
   * A fixed offset would pass here and be an hour wrong for four months of the year. Both
   * instants are 22:00 in Orlando — one under EDT and one under EST — and only a real timezone
   * database gets both.
   */
  it('reads the hour on campus, through both halves of the year', () => {
    // 22:00 EDT (UTC-4) in June, and 21:00 the same summer evening.
    expect(campusHour(new Date('2035-06-16T02:00:00Z'))).toBe(22)
    expect(campusHour(new Date('2035-06-16T01:00:00Z'))).toBe(21)

    // 22:00 EST (UTC-5) in January. An hour later in UTC for the same wall
    // clock, which is the whole point.
    expect(campusHour(new Date('2035-01-16T03:00:00Z'))).toBe(22)
    expect(campusHour(new Date('2035-01-16T02:00:00Z'))).toBe(21)
  })

  it('is open through the day and shut overnight, on both sides of midnight', () => {
    const at = (hour: number) => {
      const date = new Date(DAYTIME)
      // DAYTIME is 14:00 in Orlando, so this walks the same day's clock.
      date.setUTCHours(date.getUTCHours() + (hour - 14))
      return date
    }

    expect(buildingOpen(at(BUILDING_OPENS_AT))).toBe(true)
    expect(buildingOpen(at(BUILDING_CLOSES_AT - 1))).toBe(true)
    expect(buildingOpen(at(BUILDING_CLOSES_AT))).toBe(false)
    // Gone midnight, which is the case a naive `hour >= 22 && hour < 8` gets
    // backwards.
    expect(buildingOpen(at(2))).toBe(false)
    expect(buildingOpen(at(BUILDING_OPENS_AT - 1))).toBe(false)
  })

  it('refuses to open the lab, and says why', async () => {
    vi.setSystemTime(NIGHT)

    const response = await flip(true, officerCookie)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: expect.stringContaining('The building is shut between 10pm and 8am'),
    })
    expect(await row()).toBeNull()
    expect(posted).not.toHaveBeenCalled()
    // Refused before Discord is touched at all, so no rename is spent on it.
    expect(renamed).not.toHaveBeenCalled()
  })

  /** An officer realising at 22:05 that they left it open is the last person this should argue
      with. */
  it('still lets an officer close it', async () => {
    await flip(true, officerCookie)

    vi.setSystemTime(NIGHT)
    expect((await flip(false, officerCookie)).status).toBe(200)

    expect((await row())?.open).toBe(false)
  })

  /**
   * The masking half. The sweep runs every ten minutes, so between 22:00 and whenever it next
   * fires the row still says open — and the site must not.
   */
  it('reads closed the moment the building shuts, before any sweep', async () => {
    await flip(true, officerCookie)

    vi.setSystemTime(NIGHT)

    await expect((await read()).json()).resolves.toMatchObject({
      open: false,
      buildingOpen: false,
    })

    // And the row itself is untouched, which is what the sweep is for.
    expect((await row())?.open).toBe(true)
  })

  it('tells the pages whether anybody could open it', async () => {
    await expect((await read()).json()).resolves.toMatchObject({
      buildingOpen: true,
    })

    vi.setSystemTime(NIGHT)

    await expect((await read()).json()).resolves.toMatchObject({
      buildingOpen: false,
    })
  })

  /** The writing half: the row is closed for real, so Discord is told and the record carries a
      time. */
  it('locks up on the sweep, and attributes it to nobody', async () => {
    await flip(true, officerCookie)
    edited.mockClear()
    renamed.mockClear()

    vi.setSystemTime(NIGHT)
    await expect(sweepLabStatus()).resolves.toEqual({
      closed: true,
      adopted: false,
      retried: false,
    })
    await pendingLabPush()

    const after = await row()
    expect(after?.open).toBe(false)
    expect(after?.changedAt).toEqual(NIGHT)
    // Not the officer who opened it at six — they did not close it.
    expect(after?.changedById).toBeNull()

    // The sign follows: the same message edited, and the channel back to red.
    expect(edited.mock.calls[0]?.[2]).toContain('THE LAB IS CLOSED')
    expect(edited.mock.calls[0]?.[2]).toContain('The building is shut')
    expect(renamed.mock.calls[0]?.[1]).toBe(LAB_CHANNEL_NAME.closed)
  })

  /**
   * The one write that isn't vetoed by Discord, and the asymmetry is the point: an officer's
   * press is a request, and ten at night is not. A green sign over a locked building all night
   * isn't worth protecting the rename budget for.
   */
  it('locks up even when the rename is throttled', async () => {
    await flip(true, officerCookie)

    renamed.mockResolvedValue({ status: 'throttled', retryAfterMs: 300_000 })
    vi.setSystemTime(NIGHT)

    await expect(sweepLabStatus()).resolves.toMatchObject({ closed: true })
    await pendingLabPush()

    const after = await row()
    expect(after?.open).toBe(false)
    expect(after?.discordSynced).toBe(false)
  })

  it('locks up whether or not Discord is configured', async () => {
    await flip(true, officerCookie)

    vi.setSystemTime(NIGHT)
    await sweepLabStatus()

    // The site's own answer isn't the bot's to hold up. (Configured here, but the check sits
    // above the `labChannelConfigured` guard for the club that has no bot at all.)
    expect((await row())?.open).toBe(false)
  })

  it('does nothing on a lab that is already closed', async () => {
    await flip(true, officerCookie)
    await flip(false, officerCookie)
    edited.mockClear()
    renamed.mockClear()

    vi.setSystemTime(NIGHT)
    await expect(sweepLabStatus()).resolves.toMatchObject({ closed: false })

    expect(renamed).not.toHaveBeenCalled()
  })

  /**
   * The curfew closes and never opens. A lab that sprang back open at eight because it had been
   * open at 21:59 would be a sign nobody made, on a room nobody is in.
   */
  it('does not re-open in the morning', async () => {
    await flip(true, officerCookie)

    vi.setSystemTime(NIGHT)
    await sweepLabStatus()
    await pendingLabPush()

    // Nine the next morning.
    vi.setSystemTime(new Date('2035-06-16T13:00:00Z'))
    await sweepLabStatus()

    await expect((await read()).json()).resolves.toMatchObject({
      open: false,
      buildingOpen: true,
    })
  })
})

describe('labMessage', () => {
  const at = new Date('2026-08-22T18:00:00.000Z')

  it('names the officer and dates itself in the reader’s own clock', () => {
    const message = labMessage({
      open: true,
      changedAt: at,
      changedBy: 'Rowan Chen',
      buildingOpen: true,
    })

    expect(message).toContain('THE LAB IS OPEN')
    expect(message).toContain('Opened by Rowan Chen')
    // Discord's relative timestamp, so the sign keeps counting without being
    // edited again.
    expect(message).toContain(`<t:${Math.floor(at.getTime() / 1000)}:R>`)
  })

  it('says only the state when nobody has set it', () => {
    const message = labMessage({
      open: false,
      changedAt: null,
      changedBy: null,
      buildingOpen: true,
    })

    expect(message).toBe('🔴 **THE LAB IS CLOSED**')
  })

  /** `changedById` is `SetNull`, so an account deleted a year later leaves a real flip with
      nobody attached to it. The time is still worth saying. */
  it('drops the name when the account has gone, and keeps the time', () => {
    const message = labMessage({
      open: false,
      changedAt: at,
      changedBy: null,
      buildingOpen: true,
    })

    expect(message).toContain('Closed <t:')
    expect(message).not.toContain('by')
  })

  /** A lab reading CLOSED at 2am looks exactly like one somebody forgot to open. Saying why is
      what stops the reader walking over to check. */
  it('says the building is shut when it is', () => {
    const message = labMessage({
      open: false,
      changedAt: at,
      changedBy: null,
      buildingOpen: false,
    })

    expect(message).toContain('The building is shut between 10pm and 8am')
  })

  /** Both halves of the sign are written and read with the same two strings. Change the wording
      in one place and forget the other and the reconcile silently stops adopting anything. */
  it('writes headlines the reconcile can read back', () => {
    for (const open of [true, false]) {
      const message = labMessage({
        open,
        changedAt: at,
        changedBy: null,
        buildingOpen: true,
      })

      expect(signSays(message)).toBe(open)
    }
  })
})
