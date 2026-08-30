import { prisma } from '../core/db.js'
import { discordConfigured, sendDirectMessage } from '../discord/discord.js'
import { recipientFor } from '../discord/discordRecipient.js'
import { env } from '../core/env.js'
import { Season } from '../generated/prisma/enums.js'
import { billableTerm, trialEndsAt } from './semester.js'

/**
 * Telling people their free trial is over, once.
 *
 * Everybody gets the first three weeks of a fall or spring term free, so the
 * trial ends for the whole club on the same afternoon. That shape is what makes
 * this awkward: there is no per-person event to hang a message off, so
 * something has to wake up, notice the date has passed, and work through
 * everyone who did not pay.
 *
 * Which makes sending exactly one message the entire problem. The sweep runs
 * every ten minutes, on every API instance, and will run again after a deploy
 * or a crash halfway through a batch — so "have we already told this person"
 * cannot be something the process remembers. It is a row, and the row is
 * *claimed before the message is sent*:
 *
 *   insert (userId, termYear, termSeason)   <- primary key; a second attempt
 *                                              collides and gives up here
 *   send the DM
 *   record how it went
 *
 * The order matters and it is not the obvious one. Claiming first means a
 * message that fails to send is never retried — at-most-once rather than
 * at-least-once — and that is the right way round for this. A member who never
 * hears from the bot finds out their dues are due from the dues page, which is
 * the same place the message was going to send them. A member who gets told
 * four times because a timeout landed after Discord had already accepted the
 * message has been annoyed by the club's own robot, which is the failure this
 * was asked to avoid.
 */

/**
 * There is no role exemption, and there deliberately isn't one any more.
 *
 * `ALUMNUS` and `MENTOR` used to be skipped here — graduates owe nothing, and
 * the faculty advisor is not on dues. Both stopped being roles when `UserRole`
 * was cut back to what somebody's standing in the club actually is, and the
 * exemption went with them rather than being rebuilt on something else.
 *
 * Two ways to keep somebody off this list, and each is a truer statement than
 * the role was: `active: false` for people who are done with the club, which
 * this sweep already respects; or a `duesPaidThrough` set far ahead for the
 * advisor and any non-student mentor, which *also* stops `requireCurrentDues`
 * locking them out of the site. The second is what the club should do for the
 * faculty advisor — the old exemption quietly did half of it.
 *
 * Everybody else was always included on purpose: officers pay dues like anyone
 * else, and a sweep that skipped them would be a bug nobody noticed until an
 * officer asked why they were never reminded.
 */
/**
 * The wording changed when the free window did, and it had to.
 *
 * This used to be a courtesy: the trial ending moved somebody from free access
 * to owing money, but the site went on letting them in until the sweep caught
 * up, and the message could be read at leisure. Access is `duesPaidThrough` now
 * and nothing else, so the moment this fires is the moment their Discord
 * Members role comes off and the dashboard shuts. The message says that plainly
 * rather than making them work it out from a padlock.
 */
const message = (firstName: string, term: string, url: string) =>
  [
    `Hi ${firstName} — the free window at the Robotics Club of Central Florida has closed for ${term}.`,
    '',
    'That means your club access has paused: the lab, project tools and your Members role in this server all come back the moment dues go through.',
    '',
    `Dues are $25 for the semester or $50 for the year. The $25 covers ${term} and ends with it; summer is free, so a year bought now runs through both of the terms that are not.`,
    '',
    `You can pay here: ${url}`,
    '',
    'Your projects are still yours and nothing has been removed — you can still see them, you just cannot change anything until dues are current. If you have already paid, or you think this reached you by mistake, reply to an officer in the server and we will sort it out.',
  ].join('\n')

const TERM_NAMES: Record<Season, string> = {
  [Season.SPRING]: 'spring',
  [Season.SUMMER]: 'summer',
  [Season.FALL]: 'fall',
}

export interface SweepReport {
  claimed: number
  sent: number
  failed: number
  /** Candidates the bot has no way to reach, left unclaimed so a later run can. */
  unreachable: number
  skipped: string | null
}

const nothing = (why: string): SweepReport => ({
  claimed: 0,
  sent: 0,
  failed: 0,
  unreachable: 0,
  skipped: why,
})

/**
 * Message everyone whose trial has just run out and who has not paid.
 *
 * Returns a report rather than logging everything itself, so the caller decides
 * how loud to be — the timer in `index.ts` only says something when there was
 * something to say.
 */
export async function sweepTrialNotices(
  now: Date = new Date(),
): Promise<SweepReport> {
  if (!discordConfigured) return nothing('no bot configured')

  const term = await billableTerm(now)
  const endsAt = trialEndsAt(term)

  // Summer has no trial because summer is free outright, and `billableTerm`
  // never returns it — this is belt and braces against that changing.
  if (!endsAt) return nothing('no trial for this term')

  if (now < endsAt) return nothing('trial is still running')

  /**
   * How far back the sweep is willing to look.
   *
   * This is the line that stops the first run after a deploy from messaging
   * every unpaid member about a deadline six weeks gone. Anyone outside it was
   * not going to be told anything timely anyway.
   */
  const floor = new Date(
    endsAt.getTime() + env.TRIAL_NOTICE_GRACE_DAYS * 24 * 60 * 60 * 1000,
  )

  if (now > floor) return nothing('trial ended too long ago to be news')

  const candidates = await prisma.user.findMany({
    where: {
      // `active` is the only standing this sweep reads. There is no role
      // exemption — see the note above the message template.
      active: true,
      // Somebody with no handle cannot be reached this way at all. They are not
      // skipped silently — there is simply nothing to send to, and the dues
      // page is still there for them.
      discordUsername: { not: null },
      // Dues not covering today. Null means never paid, which is most of them.
      OR: [{ duesPaidThrough: null }, { duesPaidThrough: { lte: now } }],
      // Only people who actually had the trial. An account created the day
      // after it closed was never on one, and telling somebody a trial they
      // never had has expired is a worse first message than none.
      createdAt: { lt: endsAt },
      // Left join in Prisma's spelling: nobody who already has a row for this
      // term. Not the guard — the primary key below is — but it keeps the batch
      // from being the whole club every ten minutes for three days.
      trialNotices: {
        none: { termYear: term.year, termSeason: term.season },
      },
    },
    select: {
      id: true,
      fullName: true,
      discordId: true,
      discordUsername: true,
    },
    // Bounded, so one pass cannot sit in a loop hammering Discord's rate limit.
    // Ten minutes later the timer picks up where this left off.
    take: 50,
  })

  const report: SweepReport = {
    claimed: 0,
    sent: 0,
    failed: 0,
    unreachable: 0,
    skipped: null,
  }
  const payUrl = `${env.SITE_URL}/dashboard/dues`
  const termName = `${TERM_NAMES[term.season]} ${term.year}`

  for (const user of candidates) {
    // Resolved before anything is claimed, so that a Discord which is briefly
    // unreachable — or a member who has not joined the server yet — costs them
    // nothing. They stay a candidate and the next sweep tries again, right up
    // until the notice window closes.
    const recipient = await recipientFor(user)

    if (!recipient) {
      report.unreachable++
      continue
    }

    // The claim, immediately before the send. A unique violation here means
    // another instance — or this one, ten minutes ago — already has this
    // person, and the only correct thing to do is nothing at all.
    try {
      await prisma.trialNotice.create({
        data: {
          userId: user.id,
          termYear: term.year,
          termSeason: term.season,
        },
      })
    } catch {
      continue
    }

    report.claimed++

    const firstName = user.fullName.trim().split(/\s+/)[0] ?? 'there'
    const delivery = await sendDirectMessage(
      recipient,
      message(firstName, termName, payUrl),
    )

    if (delivery.status === 'sent') {
      report.sent++
      await record(user.id, term.year, term.season, null)
    } else {
      report.failed++
      await record(
        user.id,
        term.year,
        term.season,
        delivery.status === 'unchecked'
          ? 'no bot configured'
          : delivery.reason,
      )
    }

    // Discord's per-route limits are generous but not unlimited, and a burst of
    // fifty DM channel opens is exactly the shape it throttles. A third of a
    // second between them keeps a sweep well inside them.
    await new Promise((resolve) => setTimeout(resolve, 300))
  }

  return report
}

/**
 * Write down how the attempt went.
 *
 * A record, not a gate — nothing reads these to decide whether to send. That
 * decision was made when the row was claimed, and this is what an officer reads
 * when somebody says they never heard anything.
 */
async function record(
  userId: string,
  termYear: number,
  termSeason: Season,
  failure: string | null,
): Promise<void> {
  try {
    await prisma.trialNotice.update({
      where: { userId_termYear_termSeason: { userId, termYear, termSeason } },
      data: { deliveredAt: failure ? null : new Date(), failure },
    })
  } catch (error) {
    // The message has already gone either way. Losing the note about it is not
    // worth failing the rest of the batch for.
    console.error(`trial notice: could not record outcome for ${userId}`, error)
  }
}
