import { prisma } from '../core/db.js'
import { discordConfigured, sendDirectMessage } from './discord.js'
import { recipientFor } from './discordRecipient.js'
import { env } from '../core/env.js'
import { CAMPUS_ZONE } from '../lab/labStatus.js'
import { TaskStatus } from '../generated/prisma/enums.js'

/**
 * Asking somebody about a task whose deadline has gone past.
 *
 * The third of the bot's three DM sweeps, and it borrows its shape from
 * `equipment/equipmentReminder.ts` rather than from `membership/trialNotice.ts`:
 * a task carries its own deadline, so there is no fixed afternoon when the
 * whole club needs messaging at once.
 *
 * Three things about it are worth knowing before changing any of it.
 *
 * **The claim is `Task.remindedFor`, and it holds the deadline the message
 * named** rather than a flag or a send time. That one value deduplicates across
 * instances, survives a restart, and re-arms itself when a lead moves the due
 * date — a task pushed to next Friday is a different deadline and earns a
 * second message without anybody clearing anything. A task reopened against the
 * *same* past deadline does not, which is correct: they were already told.
 *
 * **It looks back rather than forward.** The loan reminder fires before a
 * deadline, because walking a drill back to the lab is something you do in
 * advance. There is nothing useful to say about a task before its deadline, so
 * this waits until one is properly past: `TASK_OVERDUE_GRACE_MINUTES` is the
 * club's half hour, and `TASK_OVERDUE_LOOKBACK_DAYS` is the floor that stops
 * the first sweep after a deploy asking the whole club about last semester.
 *
 * **One message per person, not per task.** Somebody who let three things slip
 * on the same evening has had one bad week rather than three, and three DMs
 * thirty seconds apart is the club's own robot nagging. So the loop claims
 * tasks and the sending happens afterwards, grouped — which is also why `sent`
 * and `failed` in the report count *messages* while `claimed` counts *tasks*.
 *
 * The ten-minute tick means a message lands 30 to 40 minutes after a deadline
 * rather than exactly 30. Nothing about a task goes wrong in that slack, and
 * closing it would mean a second scheduler to keep alive.
 */

/** Anything a member could still act on. Settled work is nobody's business. */
const CHASEABLE = [TaskStatus.OPEN, TaskStatus.IN_PROGRESS, TaskStatus.DELAYED]

/**
 * The deadline as it was meant — on the campus wall clock.
 *
 * "Due at ten" means ten in Orlando, the same rule `labStatus.ts` owns for the
 * building's hours. Rendered in the server's own zone this would tell a member
 * their task was due at an hour nobody wrote down.
 */
const when = (at: Date) =>
  at.toLocaleString('en-US', {
    timeZone: CAMPUS_ZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

interface Owed {
  title: string
  project: string | null
  dueAt: Date
}

/**
 * What lands in the DM.
 *
 * Two ways to answer it rather than one, deliberately. "You are late" with only
 * a single reply available is a message people learn to ignore; marking
 * something delayed is a real answer, and the label exists so that it is one.
 */
const message = (firstName: string, owed: Owed[], url: string) => {
  const many = owed.length > 1
  const count = String(owed.length)

  return [
    many
      ? `Hi ${firstName} — ${count} of your tasks at the Robotics Club of Central Florida have gone past their deadlines.`
      : `Hi ${firstName} — one of your tasks at the Robotics Club of Central Florida has gone past its deadline.`,
    '',
    ...owed.map(
      (task) =>
        `- ${task.title}${task.project === null ? '' : ` (${task.project})`} — was due ${when(task.dueAt)}`,
    ),
    '',
    many
      ? 'If any of these are done, tick them off. If they are going to be late, mark them delayed so whoever asked knows where they stand.'
      : 'If it is done, tick it off. If it is going to be late, mark it delayed so whoever asked knows where it stands.',
    '',
    `Your tasks are here: ${url}`,
  ].join('\n')
}

export interface TaskReminderReport {
  /** Tasks this run took responsibility for messaging about. */
  claimed: number
  /** Messages Discord accepted — one per person, not one per task. */
  sent: number
  failed: number
  /** Tasks nobody assigned is reachable on, left unclaimed so a later run can. */
  unreachable: number
  skipped: string | null
}

const nothing = (why: string): TaskReminderReport => ({
  claimed: 0,
  sent: 0,
  failed: 0,
  unreachable: 0,
  skipped: why,
})

/**
 * Ask everybody whose deadline has just gone past about it.
 *
 * Returns a report rather than logging it, so the timer in `index.ts` decides
 * how loud to be — most runs have nothing to say.
 */
export async function sweepTaskReminders(
  now: Date = new Date(),
): Promise<TaskReminderReport> {
  if (!discordConfigured) return nothing('no bot configured')

  const latest = new Date(
    now.getTime() - env.TASK_OVERDUE_GRACE_MINUTES * 60 * 1000,
  )
  const earliest = new Date(
    now.getTime() - env.TASK_OVERDUE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  )

  const candidates = await prisma.task.findMany({
    where: {
      status: { in: CHASEABLE },
      // Past the grace period, and no older than the look-back floor.
      dueAt: { gt: earliest, lte: latest },
      // At least one assignee the bot could conceivably reach. Either column
      // will do: `recipientFor` takes the snowflake when there is one and
      // resolves the handle when there is not.
      assignees: {
        some: {
          user: {
            OR: [
              { discordId: { not: null } },
              { discordUsername: { not: null } },
            ],
          },
        },
      },
    },
    orderBy: { dueAt: 'asc' },
    // Bounded so one pass cannot sit in a loop against Discord's rate limit.
    // Ten minutes later the timer picks up whatever is left.
    take: 50,
    select: {
      id: true,
      title: true,
      dueAt: true,
      remindedFor: true,
      project: { select: { title: true } },
      assignees: {
        select: {
          user: {
            select: {
              id: true,
              fullName: true,
              discordId: true,
              discordUsername: true,
            },
          },
        },
      },
    },
  })

  const report: TaskReminderReport = {
    claimed: 0,
    sent: 0,
    failed: 0,
    unreachable: 0,
    skipped: null,
  }

  /** Snowflake -> the person, and everything of theirs that has just gone late. */
  const owed = new Map<string, { firstName: string; tasks: Owed[] }>()

  for (const task of candidates) {
    // Non-null: the query asked for a `dueAt` inside a window.
    const dueAt = task.dueAt!

    // Already said, about this deadline. Filtered here rather than in the
    // `where` above because it is a comparison between two columns of the same
    // row, which Prisma has no way to express — and the window is a handful of
    // rows, so reading them to find out costs nothing.
    if (task.remindedFor?.getTime() === dueAt.getTime()) continue

    // Every recipient resolved *before* the claim, so a Discord that is briefly
    // unreachable costs this task nothing: it stays a candidate and the next
    // run tries again. Claiming first would burn its one message on a timeout.
    const reachable: { recipient: string; firstName: string }[] = []
    for (const { user } of task.assignees) {
      const recipient = await recipientFor(user)
      if (recipient !== null) {
        reachable.push({
          recipient,
          firstName: user.fullName.trim().split(/\s+/)[0] ?? 'there',
        })
      }
    }

    if (reachable.length === 0) {
      report.unreachable++
      continue
    }

    // The claim: compare-and-set on the value we just read. A second instance
    // arriving at the same row has either not written yet (and one of the two
    // `updateMany`s matches nothing) or has written already (and this one
    // matches nothing). Either way exactly one message goes out.
    const claim = await prisma.task.updateMany({
      where: { id: task.id, remindedFor: task.remindedFor },
      data: { remindedFor: dueAt },
    })

    if (claim.count === 0) continue

    report.claimed++

    for (const { recipient, firstName } of reachable) {
      const entry = owed.get(recipient) ?? { firstName, tasks: [] }
      entry.tasks.push({
        title: task.title,
        project: task.project?.title ?? null,
        dueAt,
      })
      owed.set(recipient, entry)
    }
  }

  const tasksUrl = `${env.SITE_URL}/dashboard/tasks`

  for (const [recipient, { firstName, tasks }] of owed) {
    const delivery = await sendDirectMessage(
      recipient,
      message(firstName, tasks, tasksUrl),
    )

    if (delivery.status === 'sent') report.sent++
    else report.failed++

    // Discord throttles a burst of DM channel opens harder than anything else
    // the bot does. A third of a second between them keeps a sweep well inside
    // the limit — the same pacing the other two DM sweeps use.
    await new Promise((resolve) => setTimeout(resolve, 300))
  }

  return report
}
