import { prisma } from '../core/db.js'
import { discordConfigured, sendDirectMessage } from '../discord/discord.js'
import { recipientFor } from '../discord/discordRecipient.js'
import { env } from '../core/env.js'
import { LoanStatus } from '../generated/prisma/enums.js'

/**
 * Telling somebody their borrowed thing is due back tomorrow.
 *
 * Unlike the trial notice, this has a per-person date to hang off — every loan
 * carries its own deadline — so there is no fixed afternoon when the whole club
 * needs messaging at once. What is the same is the awkward part: the sweep runs
 * every ten minutes on every API instance and will run again after a deploy, so
 * "have we already told this person" cannot be something the process remembers.
 *
 * It is a column, and the column holds **the deadline the message named**
 * rather than a flag or a send time. `EquipmentLoan.remindedFor` explains why
 * at length; the short version is that it does the deduplication and the
 * re-arming with one value. An officer who extends a loan by a week has, by
 * writing a different `dueAt`, asked for a second reminder — and gets one,
 * without anybody having to remember to clear a flag.
 *
 * Claimed before the message goes out, in the same order and for the same
 * reason as `trialNotice.ts`: at-most-once. Being told nothing means the member
 * still has the due date on their dashboard. Being told four times because a
 * timeout landed after Discord had already accepted the message is the club's
 * own robot nagging somebody who did nothing wrong.
 */

/** Only the things somebody is physically holding. */
const REMINDABLE = LoanStatus.CHECKED_OUT

const message = (firstName: string, item: string, due: Date, url: string) =>
  [
    `Hi ${firstName} — the ${item} you borrowed from the Robotics Club of Central Florida is due back ${due.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.`,
    '',
    'Bring it to the lab and an officer will check it in. If you need it for longer, ask an officer before it is due rather than after.',
    '',
    `Your borrowing is here: ${url}`,
  ].join('\n')

export interface ReminderReport {
  /** Loans this run took responsibility for messaging about. */
  claimed: number
  sent: number
  failed: number
  /** Borrowers the bot has no way to reach, left unclaimed so a later run can. */
  unreachable: number
  skipped: string | null
}

const nothing = (why: string): ReminderReport => ({
  claimed: 0,
  sent: 0,
  failed: 0,
  unreachable: 0,
  skipped: why,
})

/**
 * Message everybody whose loan falls due inside the lead window.
 *
 * Returns a report rather than logging it, so the timer in `index.ts` decides
 * how loud to be — most runs have nothing to say.
 */
export async function sweepReturnReminders(
  now: Date = new Date(),
): Promise<ReminderReport> {
  if (!discordConfigured) return nothing('no bot configured')

  const horizon = new Date(
    now.getTime() + env.RETURN_REMINDER_LEAD_HOURS * 60 * 60 * 1000,
  )

  const candidates = await prisma.equipmentLoan.findMany({
    where: {
      status: REMINDABLE,
      // Still to come, and inside the window. Nothing for an overdue loan:
      // this is a reminder, and a thing that was due last Tuesday needs an
      // officer having a word rather than a robot pointing at the calendar.
      dueAt: { gt: now, lte: horizon },
      user: { discordUsername: { not: null } },
    },
    orderBy: { dueAt: 'asc' },
    // Bounded so one pass cannot sit in a loop against Discord's rate limit.
    // Ten minutes later the timer picks up whatever is left.
    take: 50,
    select: {
      id: true,
      dueAt: true,
      remindedFor: true,
      equipment: { select: { name: true } },
      user: {
        select: {
          id: true,
          fullName: true,
          discordId: true,
          discordUsername: true,
        },
      },
    },
  })

  const report: ReminderReport = {
    claimed: 0,
    sent: 0,
    failed: 0,
    unreachable: 0,
    skipped: null,
  }
  const loansUrl = `${env.SITE_URL}/dashboard/equipment`

  for (const loan of candidates) {
    // Non-null: the query asked for a `dueAt` inside a window.
    const dueAt = loan.dueAt!

    // Already said, about this deadline. Filtered here rather than in the
    // `where` above because it is a comparison between two columns of the same
    // row, which Prisma has no way to express — and the window is a handful of
    // rows, so reading them to find out costs nothing.
    if (loan.remindedFor?.getTime() === dueAt.getTime()) continue

    // Before the claim, so a Discord that is briefly unreachable — or a member
    // who has not joined the server — costs them nothing. They stay a candidate
    // and the next run tries again, right up until the loan falls due.
    const recipient = await recipientFor(loan.user)

    if (!recipient) {
      report.unreachable++
      continue
    }

    // The claim: compare-and-set on the value we just read. A second instance
    // arriving at the same row has either not written yet (and one of the two
    // `updateMany`s matches nothing) or has written already (and this one
    // matches nothing). Either way exactly one message goes out.
    const claim = await prisma.equipmentLoan.updateMany({
      where: { id: loan.id, remindedFor: loan.remindedFor },
      data: { remindedFor: dueAt },
    })

    if (claim.count === 0) continue

    report.claimed++

    const firstName = loan.user.fullName.trim().split(/\s+/)[0] ?? 'there'
    const delivery = await sendDirectMessage(
      recipient,
      message(firstName, loan.equipment.name, dueAt, loansUrl),
    )

    if (delivery.status === 'sent') report.sent++
    else report.failed++

    // Discord throttles a burst of DM channel opens harder than anything else
    // the bot does. A third of a second between them keeps a sweep well inside
    // the limit — the same pacing the trial notice uses.
    await new Promise((resolve) => setTimeout(resolve, 300))
  }

  return report
}
