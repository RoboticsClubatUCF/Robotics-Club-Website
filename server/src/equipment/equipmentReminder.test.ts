import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '../core/db.js'
import { checkDiscordHandle, sendDirectMessage } from '../discord/discord.js'
import { sweepReturnReminders } from './equipmentReminder.js'
import { LoanStatus, UserRole } from '../generated/prisma/enums.js'

/**
 * The "due back tomorrow" DM, and the property that matters: exactly one per
 * deadline.
 *
 * **This sweep is roster-wide.** It takes every checked-out loan falling due
 * inside the lead window, not only the ones these tests made — the same trap
 * `trialNotice.test.ts` documents. The isolation here is the clock: every
 * fixture loan is due in **2035** and every call passes a 2035 `now`, so the
 * window the sweep looks at cannot contain a real loan. Nothing belonging to a
 * real member is claimed, messaged, or written to.
 *
 * Both Discord calls are stubbed for the usual reasons — one would DM a real
 * account, the other would search the club's actual guild — and
 * `discordConfigured` is forced true because the sweep declines to run without
 * a bot, which is not something the assertions should depend on.
 */
vi.mock('../discord/discord.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../discord/discord.js')>()),
  discordConfigured: true,
  sendDirectMessage: vi.fn(),
  checkDiscordHandle: vi.fn(),
}))

const dm = vi.mocked(sendDirectMessage)
const lookup = vi.mocked(checkDiscordHandle)

const PREFIX = 'test-remind-'
const DISCORD_ID = '742910385274910385'

/** Well clear of any real loan, and of any real due date. */
const NOW = new Date('2035-03-01T12:00:00')
const day = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000)

/** Only the messages sent to this file's borrower. */
const messagesToBorrower = () =>
  dm.mock.calls.filter(([recipient]) => recipient === DISCORD_ID)

const clearRows = async () => {
  await prisma.equipment.deleteMany({ where: { name: { startsWith: PREFIX } } })
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
}

let borrowerId: string
let itemId: string

beforeEach(async () => {
  dm.mockReset()
  dm.mockResolvedValue({ status: 'sent' })
  // Keyed on the handle rather than a flat answer: the sweep looks up anybody
  // with no stored id, and a stub that said "connected" to everything would
  // write this file's snowflake onto a real account.
  lookup.mockReset()
  lookup.mockImplementation(async () => ({ status: 'not_found' }))

  await clearRows()

  const [borrower, item] = await Promise.all([
    prisma.user.create({
      data: {
        fullName: 'Remind Borrower',
        email: `${PREFIX}borrower@ucf.edu`,
        role: UserRole.MEMBER,
        discordUsername: `${PREFIX}handle`,
        discordId: DISCORD_ID,
      },
    }),
    prisma.equipment.create({ data: { name: `${PREFIX}Cordless drill` } }),
  ])

  borrowerId = borrower.id
  itemId = item.id
})

afterAll(async () => {
  await clearRows()
  await prisma.$disconnect()
})

const lend = (over: Record<string, unknown> = {}) =>
  prisma.equipmentLoan.create({
    data: {
      equipmentId: itemId,
      userId: borrowerId,
      status: LoanStatus.CHECKED_OUT,
      dueAt: day(1),
      ...over,
    },
    select: { id: true },
  })

describe('the return reminder', () => {
  it('messages the borrower once, and never again for the same deadline', async () => {
    const { id } = await lend()

    const first = await sweepReturnReminders(NOW)

    expect(first).toMatchObject({ claimed: 1, sent: 1, failed: 0 })
    expect(messagesToBorrower()).toHaveLength(1)
    expect(messagesToBorrower()[0]?.[1]).toContain(`${PREFIX}Cordless drill`)

    // The claim is the deadline it was about, written on the row — so a
    // restart, a second instance and the next tick all arrive here.
    expect(
      await prisma.equipmentLoan.findUniqueOrThrow({ where: { id } }),
    ).toMatchObject({ remindedFor: day(1) })

    const second = await sweepReturnReminders(NOW)

    expect(second.claimed).toBe(0)
    expect(messagesToBorrower()).toHaveLength(1)
  })

  /**
   * The reason the column holds a date instead of a flag. An officer extending
   * a loan has asked for a second reminder by doing so, and nobody has to
   * remember to clear anything.
   */
  it('says it again when an officer moves the due date', async () => {
    const { id } = await lend()
    await sweepReturnReminders(NOW)

    await prisma.equipmentLoan.update({
      where: { id },
      data: { dueAt: day(6) },
    })

    // Not yet — six days out is past the lead window.
    expect((await sweepReturnReminders(NOW)).claimed).toBe(0)

    const later = await sweepReturnReminders(day(5))

    expect(later).toMatchObject({ claimed: 1, sent: 1 })
    expect(messagesToBorrower()).toHaveLength(2)
  })

  it('leaves alone anything outside the window, in either direction', async () => {
    // A fortnight away: not news yet.
    const soon = await lend({ dueAt: day(14) })
    expect((await sweepReturnReminders(NOW)).claimed).toBe(0)

    // Already overdue: that is a conversation with an officer, not a nudge
    // from a robot pointing at a date that has gone.
    await prisma.equipmentLoan.update({
      where: { id: soon.id },
      data: { dueAt: day(-2) },
    })
    expect((await sweepReturnReminders(NOW)).claimed).toBe(0)
    expect(messagesToBorrower()).toHaveLength(0)
  })

  it('only chases things somebody is actually holding', async () => {
    // Set aside but not collected — there is nothing in their hands to bring
    // back, and a loan with no due date has no day before it.
    await lend({ status: LoanStatus.APPROVED })
    await lend({ status: LoanStatus.RETURNED })
    await lend({ status: LoanStatus.CHECKED_OUT, dueAt: null })

    expect((await sweepReturnReminders(NOW)).claimed).toBe(0)
    expect(messagesToBorrower()).toHaveLength(0)
  })

  /**
   * Claimed before the send, so a message Discord refuses is not retried. The
   * borrower still has the date on their dashboard; being DMed four times
   * because a timeout landed late is the failure worth avoiding.
   */
  it('claims before sending, so a refusal is not repeated', async () => {
    await lend()
    dm.mockResolvedValue({ status: 'refused', reason: 'dms are closed' })

    const first = await sweepReturnReminders(NOW)

    expect(first).toMatchObject({ claimed: 1, sent: 0, failed: 1 })
    expect((await sweepReturnReminders(NOW)).claimed).toBe(0)
  })

  /**
   * The other way round from a refusal: nothing is claimed, because nothing was
   * attempted. They stay a candidate until the loan falls due.
   */
  it('leaves an unreachable borrower unclaimed for the next run', async () => {
    await prisma.user.update({
      where: { id: borrowerId },
      data: { discordId: null },
    })
    const { id } = await lend()

    const report = await sweepReturnReminders(NOW)

    expect(report).toMatchObject({ claimed: 0, unreachable: 1 })
    expect(
      await prisma.equipmentLoan.findUniqueOrThrow({ where: { id } }),
    ).toMatchObject({ remindedFor: null })
  })
})
