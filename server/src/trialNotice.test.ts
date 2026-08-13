import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from './db.js'
import { checkDiscordHandle, sendDirectMessage } from './discord.js'
import { clearCalendarCache } from './semester.js'
import { sweepTrialNotices } from './trialNotice.js'

/**
 * The trial-end message, and the one property it has to have: exactly one of
 * them reaches each person.
 *
 * The sweep runs every ten minutes, on every API instance, and again after any
 * deploy or crash — so "have we already told this person" cannot be something
 * the process remembers. Everything below is a way of arriving at that same
 * question twice and checking that only the first one sends.
 *
 * **The sweep is global, and this runs against the real database.** It selects
 * every unpaid candidate, not only the one these tests create — so whoever is
 * sitting in the development database is swept up too. Two things follow, and
 * both cost a debugging session to learn:
 *
 *   - The fixtures are pinned to *2035*. The sweep writes a `trial_notices` row
 *     per person per term, and that row is what permanently suppresses the real
 *     message — so a suite that ran against the current year would quietly stop
 *     a genuine member ever being told their trial had ended. 2035 is a term no
 *     real notice will ever be written for, and cleanup removes the year
 *     wholesale.
 *   - Every assertion counts only the messages sent to *this* file's member.
 *     Counting all of them makes the suite pass or fail on whatever rows happen
 *     to be in the database that day.
 *
 * Both Discord calls are stubbed. `sendDirectMessage` for the obvious reason —
 * a suite that DMs a real account on every run eventually messages a real
 * member. `checkDiscordHandle` because the sweep now falls back to it for
 * anybody with no stored id, which against a real bot token would search the
 * club's actual guild.
 *
 * `discordConfigured` is forced true because the sweep declines to do anything
 * without a bot, and whether the developer running the tests has a token in
 * their `.env` is not something the assertions should depend on.
 */
vi.mock('./discord.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./discord.js')>()),
  discordConfigured: true,
  sendDirectMessage: vi.fn(),
  checkDiscordHandle: vi.fn(),
}))

const dm = vi.mocked(sendDirectMessage)
const lookup = vi.mocked(checkDiscordHandle)

const EMAIL = 'test-trial@ucf.edu'
const HANDLE = 'test_trial_handle'
const DISCORD_ID = '864297531086429753'

/** The year the fixtures live in — see the note above about why it is not this one. */
const TERM_YEAR = 2035

/**
 * With the calendar feed stubbed out, fall falls back to its fixed dates:
 * classes on 24 August, so the fourteen-day trial closes on 7 September. The
 * eighth is one day past that and inside the notice window.
 */
const JUST_AFTER_TRIAL = new Date('2035-09-08T12:00:00')
/** Well past it — the case a mid-semester deploy would otherwise walk into. */
const LONG_AFTER_TRIAL = new Date('2035-11-01T12:00:00')

/** Only the messages sent to this file's member. See the note above. */
const messagesToMember = () =>
  dm.mock.calls.filter(([recipient]) => recipient === DISCORD_ID)

const clearRows = async () => {
  // The whole year, not only this file's member: the sweep claims a row for
  // every candidate it finds, including real accounts in the development
  // database, and leaving those behind is what suppresses a real notice.
  await prisma.trialNotice.deleteMany({ where: { termYear: TERM_YEAR } })
  await prisma.user.deleteMany({ where: { email: EMAIL } })
}

/** Somebody who signed up before the trial closed and never paid. */
async function unpaidMember(over: Record<string, unknown> = {}) {
  return prisma.user.create({
    data: {
      fullName: 'Trial Member',
      email: EMAIL,
      discordUsername: HANDLE,
      discordId: DISCORD_ID,
      createdAt: new Date('2035-08-25T12:00:00'),
      ...over,
    },
    select: { id: true },
  })
}

beforeEach(async () => {
  clearCalendarCache()
  // Offline: every term falls back to its fixed dates, so the trial deadline is
  // the same on every machine and in every week of the year.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('nope', { status: 503 }))),
  )

  dm.mockReset()
  dm.mockResolvedValue({ status: 'sent' })
  // Keyed on the handle, never a flat answer. The sweep looks up *every*
  // candidate it finds, so a stub that answered "connected" to anything would
  // hand this file's snowflake to whoever else is in the development database —
  // and the sweep writes what it is told back to their account.
  lookup.mockReset()
  lookup.mockImplementation(async () => ({ status: 'not_found' }))

  await clearRows()
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearCalendarCache()
})

afterAll(async () => {
  await clearRows()
  await prisma.$disconnect()
})

describe('sweepTrialNotices', () => {
  it('messages an unpaid member once the trial has closed', async () => {
    const { id } = await unpaidMember()

    const report = await sweepTrialNotices(JUST_AFTER_TRIAL)

    expect(report.sent).toBeGreaterThanOrEqual(1)
    expect(dm).toHaveBeenCalledWith(DISCORD_ID, expect.stringContaining('trial'))

    const notice = await prisma.trialNotice.findFirst({ where: { userId: id } })
    expect(notice?.deliveredAt).toBeInstanceOf(Date)
    expect(notice?.failure).toBeNull()
  })

  /** The message names the price and where to pay, or it is a message about nothing. */
  it('says what it costs and where to pay it', async () => {
    await unpaidMember()

    await sweepTrialNotices(JUST_AFTER_TRIAL)

    const [, content] = messagesToMember()[0]!
    expect(content).toContain('$25')
    expect(content).toContain('$50')
    expect(content).toContain('/dues')
  })

  /**
   * The one that matters. The sweep fires every ten minutes for as long as the
   * window is open, and a member who got the same DM six times an hour would be
   * right to leave the server.
   */
  it('sends nothing the second time it runs', async () => {
    await unpaidMember()

    await sweepTrialNotices(JUST_AFTER_TRIAL)
    dm.mockClear()

    const second = await sweepTrialNotices(JUST_AFTER_TRIAL)

    expect(second.claimed).toBe(0)
    expect(messagesToMember()).toHaveLength(0)
  })

  /**
   * Two API instances waking on the same timer. The claim is an insert on the
   * primary key, so one wins and the other collides — which is the whole reason
   * this is a table rather than a timestamp somewhere.
   */
  it('sends once even when two sweeps run at the same moment', async () => {
    await unpaidMember()

    await Promise.all([
      sweepTrialNotices(JUST_AFTER_TRIAL),
      sweepTrialNotices(JUST_AFTER_TRIAL),
    ])

    expect(messagesToMember()).toHaveLength(1)
  })

  /**
   * Claimed before the message is sent, so a failure is never retried. That is
   * the right way round here: somebody who hears nothing finds out from the
   * dues page, and somebody who hears four times has been annoyed by the club's
   * own robot.
   */
  it('does not try again after a message that failed to send', async () => {
    dm.mockResolvedValue({ status: 'refused', reason: 'DMs closed' })
    const { id } = await unpaidMember()

    await sweepTrialNotices(JUST_AFTER_TRIAL)
    dm.mockClear()
    await sweepTrialNotices(JUST_AFTER_TRIAL)

    expect(messagesToMember()).toHaveLength(0)

    const notice = await prisma.trialNotice.findFirst({ where: { userId: id } })
    expect(notice?.deliveredAt).toBeNull()
    expect(notice?.failure).toContain('DMs closed')
  })

  /**
   * Every account made before signup started capturing the snowflake has a
   * handle and no id, and Discord's API takes an id — so without this fallback
   * those members could never be told anything. What is found is written back,
   * so the search happens once per person rather than once per sweep.
   */
  it('looks up a member whose account id was never stored, and remembers it', async () => {
    const { id } = await unpaidMember({ discordId: null })
    lookup.mockImplementation(async (handle) =>
      handle === HANDLE
        ? { status: 'connected', username: HANDLE, id: DISCORD_ID }
        : { status: 'not_found' },
    )

    await sweepTrialNotices(JUST_AFTER_TRIAL)

    expect(lookup).toHaveBeenCalledWith(HANDLE)
    expect(messagesToMember()).toHaveLength(1)
    expect(
      (await prisma.user.findUnique({ where: { id }, select: { discordId: true } }))
        ?.discordId,
    ).toBe(DISCORD_ID)
  })

  /**
   * Resolving happens *before* the notice is claimed, so somebody the bot
   * cannot reach yet — Discord briefly down, or a member who has not joined the
   * server — keeps their one message rather than having it burned on a lookup.
   * They stay a candidate until the window closes.
   */
  it('claims nothing for a member it cannot reach, so a later run still can', async () => {
    const { id } = await unpaidMember({ discordId: null })
    lookup.mockImplementation(async () => ({ status: 'unavailable' }))

    const report = await sweepTrialNotices(JUST_AFTER_TRIAL)

    expect(report.unreachable).toBeGreaterThanOrEqual(1)
    expect(messagesToMember()).toHaveLength(0)
    expect(await prisma.trialNotice.count({ where: { userId: id } })).toBe(0)

    // Discord comes back, and the message goes out on the next sweep.
    lookup.mockImplementation(async (handle) =>
      handle === HANDLE
        ? { status: 'connected', username: HANDLE, id: DISCORD_ID }
        : { status: 'not_found' },
    )
    await sweepTrialNotices(JUST_AFTER_TRIAL)

    expect(messagesToMember()).toHaveLength(1)
  })

  it('leaves a paid member alone', async () => {
    await unpaidMember({ duesPaidThrough: new Date('2035-12-13T23:59:59') })

    await sweepTrialNotices(JUST_AFTER_TRIAL)

    expect(messagesToMember()).toHaveLength(0)
  })

  /** Telling somebody a trial they never had has expired is worse than silence. */
  it('leaves alone an account created after the trial closed', async () => {
    await unpaidMember({ createdAt: new Date('2035-09-20T12:00:00') })

    await sweepTrialNotices(JUST_AFTER_TRIAL)

    expect(messagesToMember()).toHaveLength(0)
  })

  /**
   * There used to be a role exemption here — `ALUMNUS` and `MENTOR` were
   * skipped, because graduates owe nothing and the faculty advisor is not on
   * dues. Neither is a role any more, and the exemption was not rebuilt on
   * something else: this sweep now asks one question, and it is about dues.
   *
   * These two rows are the replacement, and they matter more than the deleted
   * one did — they are what say the club made a decision here rather than
   * dropping a filter by accident.
   */
  it('chases anybody active and unpaid, whatever they used to be called', async () => {
    await unpaidMember({ role: 'MEMBER' })

    await sweepTrialNotices(JUST_AFTER_TRIAL)

    expect(messagesToMember()).toHaveLength(1)
  })

  /**
   * And this is the escape hatch officers actually have. `active: false` is a
   * true statement about somebody who is done with the club — which is what the
   * `ALUMNUS` role was saying a second time — and the other is a
   * `duesPaidThrough` set far ahead, which is the right answer for the advisor
   * because it also stops `requireCurrentDues` locking them out of the site.
   */
  it('leaves an inactive account alone', async () => {
    await unpaidMember({ active: false })

    await sweepTrialNotices(JUST_AFTER_TRIAL)

    expect(messagesToMember()).toHaveLength(0)
  })

  it('says nothing while the trial is still running', async () => {
    await unpaidMember()

    const report = await sweepTrialNotices(new Date('2035-09-01T12:00:00'))

    expect(report.skipped).toBe('trial is still running')
    expect(messagesToMember()).toHaveLength(0)
  })

  /**
   * The line that stops the first sweep after a mid-semester deploy from
   * messaging every unpaid member about a deadline six weeks gone.
   */
  it('does not message about a deadline long past', async () => {
    await unpaidMember()

    const report = await sweepTrialNotices(LONG_AFTER_TRIAL)

    expect(report.skipped).toBe('trial ended too long ago to be news')
    expect(messagesToMember()).toHaveLength(0)
  })

  /** Summer is free outright, so there is no trial to have ended. */
  it('says nothing in the middle of the summer', async () => {
    await unpaidMember()

    const report = await sweepTrialNotices(new Date('2035-06-20T12:00:00'))

    expect(messagesToMember()).toHaveLength(0)
    expect(report.sent).toBe(0)
  })
})
