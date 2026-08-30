import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '../core/db.js'
import { checkDiscordHandle, sendDirectMessage } from './discord.js'
import { sweepTaskReminders } from './taskReminder.js'
import { Season, UserRole } from '../generated/prisma/enums.js'

/**
 * The overdue-task DM, and the property that matters: exactly one per deadline,
 * and one message per person rather than one per task.
 *
 * **This sweep is roster-wide.** It takes every unsettled task whose deadline
 * has just passed, not only the ones these tests made — the same trap
 * `trialNotice.test.ts` and `equipmentReminder.test.ts` document. The isolation
 * here is the clock: every fixture deadline is in **2035** and every call passes
 * a 2035 `now`, so the window the sweep looks at cannot contain a real task.
 * Nothing belonging to a real member is claimed, messaged, or written to.
 *
 * Both Discord calls are stubbed for the usual reasons — one would DM a real
 * account and the other would search the club's actual guild — and
 * `discordConfigured` is forced true because the sweep declines to run without
 * a bot, which is not something the assertions should depend on.
 */
vi.mock('./discord.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./discord.js')>()),
  discordConfigured: true,
  sendDirectMessage: vi.fn(),
  checkDiscordHandle: vi.fn(),
}))

const dm = vi.mocked(sendDirectMessage)
const lookup = vi.mocked(checkDiscordHandle)

const PREFIX = 'test-taskremind-'

/**
 * Repeated digits, because `discord_id` is unique against a database of real
 * people and a plausible-looking snowflake is one somebody might actually hold.
 */
const ALEX = '111111111111111111'
const SAM = '222222222222222222'

/** Well clear of any real deadline. */
const NOW = new Date('2035-03-01T12:00:00Z')
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60 * 1000)
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000)

/** Only the messages this file's people were sent. */
const to = (recipient: string) =>
  dm.mock.calls.filter(([who]) => who === recipient)

const clearRows = async () => {
  await prisma.project.deleteMany({ where: { slug: { startsWith: PREFIX } } })
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
}

let alexId: string
let samId: string
let projectId: string

beforeEach(async () => {
  dm.mockReset()
  dm.mockResolvedValue({ status: 'sent' })
  // Keyed on the handle rather than a flat answer: a stub saying "connected" to
  // anything would write this file's snowflake onto a real account. Nothing
  // here should reach it anyway — every fixture carries a stored id, so
  // `recipientFor` returns before looking anybody up.
  lookup.mockReset()
  lookup.mockImplementation(async () => ({ status: 'not_found' }))

  await clearRows()

  const [alex, sam, project] = await Promise.all([
    prisma.user.create({
      data: {
        fullName: 'Alex Reminder',
        email: `${PREFIX}alex@ucf.edu`,
        role: UserRole.MEMBER,
        discordId: ALEX,
      },
    }),
    prisma.user.create({
      data: {
        fullName: 'Sam Reminder',
        email: `${PREFIX}sam@ucf.edu`,
        role: UserRole.MEMBER,
        discordId: SAM,
      },
    }),
    prisma.project.create({
      data: {
        slug: `${PREFIX}rover`,
        title: 'Reminder Rover',
        termYear: 2035,
        termSeason: Season.SPRING,
      },
    }),
  ])

  alexId = alex.id
  samId = sam.id
  projectId = project.id
})

afterAll(async () => {
  await clearRows()
  await prisma.$disconnect()
})

const seedTask = (over: Record<string, unknown> = {}) =>
  prisma.task.create({
    data: {
      projectId,
      title: 'Cut the brackets',
      dueAt: minutesAgo(60),
      assignees: { create: { userId: alexId } },
      ...over,
    },
  })

describe('chasing an overdue task', () => {
  it('sends once, names the task and the project, and does not send again', async () => {
    const task = await seedTask()

    const first = await sweepTaskReminders(NOW)

    expect(first).toMatchObject({ claimed: 1, sent: 1, failed: 0 })
    expect(to(ALEX)).toHaveLength(1)

    const body = to(ALEX)[0]![1]
    expect(body).toContain('Cut the brackets')
    expect(body).toContain('Reminder Rover')
    expect(body).toContain('/dashboard/tasks')
    expect(body).toContain('Alex')

    // The claim is the deadline the message named, written before the send.
    const claimed = await prisma.task.findUniqueOrThrow({
      where: { id: task.id },
      select: { remindedFor: true },
    })
    expect(claimed.remindedFor?.toISOString()).toBe(
      minutesAgo(60).toISOString(),
    )

    // A second instance, or the next tick ten minutes later. Neither is a new
    // deadline, so neither is a new message.
    const second = await sweepTaskReminders(NOW)
    expect(second).toMatchObject({ claimed: 0, sent: 0 })
    expect(to(ALEX)).toHaveLength(1)
  })

  it('sends one message per person, naming everything of theirs at once', async () => {
    await seedTask({ title: 'Cut the brackets' })
    await seedTask({ title: 'Order the steel', dueAt: minutesAgo(90) })

    const report = await sweepTaskReminders(NOW)

    // Two tasks claimed, one message: somebody who let two things slip on the
    // same evening has had one bad week rather than two.
    expect(report).toMatchObject({ claimed: 2, sent: 1 })
    expect(to(ALEX)).toHaveLength(1)

    const body = to(ALEX)[0]![1]
    expect(body).toContain('Cut the brackets')
    expect(body).toContain('Order the steel')
  })

  it('messages every assignee of a shared task', async () => {
    await seedTask({
      assignees: { create: [{ userId: alexId }, { userId: samId }] },
    })

    const report = await sweepTaskReminders(NOW)

    expect(report).toMatchObject({ claimed: 1, sent: 2 })
    expect(to(ALEX)).toHaveLength(1)
    expect(to(SAM)).toHaveLength(1)
  })

  it('re-arms when a lead moves the deadline', async () => {
    const task = await seedTask()
    await sweepTaskReminders(NOW)
    expect(to(ALEX)).toHaveLength(1)

    // A different deadline is a different question, and the stored value no
    // longer matches it — which is the whole reason `remindedFor` holds a date
    // rather than a flag. Nothing had to be cleared by hand.
    await prisma.task.update({
      where: { id: task.id },
      data: { dueAt: minutesAgo(45) },
    })

    const again = await sweepTaskReminders(NOW)
    expect(again).toMatchObject({ claimed: 1, sent: 1 })
    expect(to(ALEX)).toHaveLength(2)
  })
})

describe('what it leaves alone', () => {
  it('says nothing about settled work', async () => {
    await seedTask({ status: 'DONE', title: 'Finished on time' })
    await seedTask({ status: 'CANCELED', title: 'Called off' })

    const report = await sweepTaskReminders(NOW)

    expect(report).toMatchObject({ claimed: 0, sent: 0 })
    expect(to(ALEX)).toHaveLength(0)
  })

  it('chases work that is started or already flagged as slipping', async () => {
    await seedTask({ status: 'IN_PROGRESS', title: 'Half done' })
    await seedTask({ status: 'DELAYED', title: 'Known late', dueAt: minutesAgo(90) })

    // DELAYED is not finished. Saying so before the deadline does not make the
    // deadline stop passing, and the claim keeps it to one message either way.
    const report = await sweepTaskReminders(NOW)
    expect(report).toMatchObject({ claimed: 2, sent: 1 })
  })

  it('waits out the grace period', async () => {
    await seedTask({ dueAt: minutesAgo(10) })

    // Ten minutes past is not late. A task ticked off five minutes after its
    // deadline should never have been chased at all.
    const report = await sweepTaskReminders(NOW)

    expect(report).toMatchObject({ claimed: 0, sent: 0 })
    expect(to(ALEX)).toHaveLength(0)
  })

  it('will not reach back past the look-back floor', async () => {
    await seedTask({ dueAt: daysAgo(5) })

    // The floor `TRIAL_NOTICE_GRACE_DAYS` exists for: without it the first
    // sweep after this deploys would DM the club about last semester.
    const report = await sweepTaskReminders(NOW)

    expect(report).toMatchObject({ claimed: 0, sent: 0 })
    expect(to(ALEX)).toHaveLength(0)
  })

  it('claims nothing when nobody on the task can be reached', async () => {
    const stranger = await prisma.user.create({
      data: {
        fullName: 'No Discord',
        email: `${PREFIX}stranger@ucf.edu`,
        role: UserRole.MEMBER,
      },
    })
    const task = await seedTask({
      assignees: { create: { userId: stranger.id } },
    })

    const report = await sweepTaskReminders(NOW)

    // Never a candidate in the first place — the query wants at least one
    // assignee with something to reach them on.
    expect(report).toMatchObject({ claimed: 0, sent: 0 })

    // And crucially unclaimed, so linking a Discord account tomorrow still
    // gets them the message.
    const row = await prisma.task.findUniqueOrThrow({
      where: { id: task.id },
      select: { remindedFor: true },
    })
    expect(row.remindedFor).toBeNull()
  })

  it('does nothing at all with a task nobody is assigned to', async () => {
    await seedTask({ assignees: undefined })

    const report = await sweepTaskReminders(NOW)

    expect(report).toMatchObject({ claimed: 0, sent: 0 })
  })
})

describe('when Discord will not take it', () => {
  it('counts the failure and still keeps the claim', async () => {
    // A member whose privacy settings refuse DMs from server members answers
    // 403 for ever. At-most-once is the right way round: being told nothing is
    // recoverable from the tasks page, being told four times is not.
    dm.mockResolvedValue({ status: 'refused', reason: 'cannot dm' })

    const task = await seedTask()
    const report = await sweepTaskReminders(NOW)

    expect(report).toMatchObject({ claimed: 1, sent: 0, failed: 1 })

    const row = await prisma.task.findUniqueOrThrow({
      where: { id: task.id },
      select: { remindedFor: true },
    })
    expect(row.remindedFor).not.toBeNull()

    dm.mockResolvedValue({ status: 'sent' })
    const again = await sweepTaskReminders(NOW)
    expect(again).toMatchObject({ claimed: 0, sent: 0 })
  })
})
