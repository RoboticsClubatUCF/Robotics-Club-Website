import { prisma } from './db.js'
import { membersWithRole, officerRoleId, officerSyncConfigured } from './discord.js'
import { UserRole } from './generated/prisma/enums.js'
import { membershipStanding } from './semester.js'

/**
 * Following the club's Discord officer role.
 *
 * The board is appointed in Discord — somebody hands out a role — and until
 * this existed the site knew nothing about it, so `OFFICER` was typed into
 * Prisma Studio by hand and forgotten about when people rotated off. This makes
 * the site follow: carry the role and you are an officer here, lose it and you
 * are not.
 *
 * **It is a third writer of `User.role`, and that was a documented invariant
 * until now.** The rule it replaces said dues moved people between `MEMBER` and
 * `GUEST` and nothing else ever wrote the column. The rule now is that three
 * writers each own exactly one edge: dues own `MEMBER`↔`GUEST`, this owns
 * `OFFICER`↔whatever-dues-say, and `ADMIN` is a human in Studio and nothing
 * else, in either direction. No writer crosses more than one boundary, which is
 * what keeps them from fighting.
 *
 * This lives beside `membershipSweep.ts` rather than inside it on purpose: that
 * file's entire header is an argument that it writes on dues alone, and it is
 * still true.
 *
 * ## Four ways it refuses to run
 *
 * Every one of them is the same worry from a different angle — that this
 * quietly stands the whole board down — and the reason there are four is that
 * Discord gives no error for the case that matters most.
 *
 *   1. **Not configured.** No role id, nothing happens, no queries. Unset is
 *      the default and it is how this ships.
 *   2. **Discord unreachable.** Write nothing. The analogue of
 *      `!standing.billable.fromCalendar` in the dues sweep, and stronger: there,
 *      bad data means approximate dates; here it means an empty roster, which
 *      reads as "demote everybody".
 *   3. **Nobody holds the role.** Stand down unconditionally, and this is the
 *      important one. **A wrong role id is not an error at Discord's API** — it
 *      returns the guild happily and the typo'd snowflake simply appears in
 *      nobody's `roles` array. A misconfigured id, a deleted role and a
 *      genuinely empty board are byte-for-byte identical, and a club where
 *      nobody is an officer is not a state worth automating into.
 *   4. **No overlap at all.** If there are sitting officers and not one of them
 *      carries the role, something is wrong with the setup rather than with the
 *      board — a whole committee does not resign between two sweeps. Ordinary
 *      turnover passes straight through; only total disjunction stops it, and
 *      the cost when it fires is that a person flips one role by hand.
 */
export interface OfficerSyncReport {
  promoted: number
  demoted: number
  /** Set when nothing was attempted, and why. */
  skipped?:
    | 'not-configured'
    | 'discord-unavailable'
    | 'no-role-holders'
    | 'no-overlap'
}

/**
 * What somebody is once they stop being an officer.
 *
 * Not a fixed value, because both ways of fixing it are wrong and both are
 * permanent.
 *
 * `MEMBER` for everybody strands the ex-officer with no `duesPaidThrough`:
 * `sweepLapsedMembers` only touches rows that have a date on them, so nothing
 * would ever move them again, and `onRoster` wants a slug and a role above
 * `GUEST` — they would sit on the public members page for ever with no path
 * off it. `GUEST` for everybody takes club membership away from somebody who
 * paid and merely stepped off the board.
 *
 * So it asks the question the dues loop asks and hands them straight back to
 * it, which also preserves that loop's own invariant: every `MEMBER` the site
 * wrote has a date the site can later read.
 */
async function standingRole(
  paidThrough: Date | null,
  now: Date,
): Promise<UserRole> {
  if (paidThrough === null) return UserRole.GUEST

  const standing = await membershipStanding(paidThrough, now)

  // On fallback dates, err towards leaving them a member. Taking membership
  // away on a guessed calendar is the mistake `membershipSweep` refuses to
  // make, and leaving somebody a `MEMBER` one sweep too long costs nothing —
  // the dues sweep reaches them the moment the calendar answers again.
  if (!standing.billable.fromCalendar) return UserRole.MEMBER

  // **`duesRequired`, not `hasAccess`** — the same signal `membershipSweep`
  // demotes on, and it has to be the same one. Access is the dues date now, so
  // `hasAccess` would put an ex-officer at `GUEST` the day their date passed
  // while an ordinary member in exactly the same position stayed a `MEMBER`
  // until the free window shut. Two loops writing one column to different
  // rules is how the roster starts contradicting itself.
  return standing.duesRequired ? UserRole.GUEST : UserRole.MEMBER
}

export async function syncDiscordOfficers(
  now: Date = new Date(),
): Promise<OfficerSyncReport> {
  const nothing = { promoted: 0, demoted: 0 }

  if (!officerSyncConfigured || officerRoleId === null) {
    return { ...nothing, skipped: 'not-configured' }
  }

  const roster = await membersWithRole(officerRoleId)

  if (roster.status !== 'ok') {
    console.warn(
      `discord officers: standing down — the guild could not be read (${
        roster.status === 'unavailable' ? roster.reason : roster.status
      })`,
    )
    return { ...nothing, skipped: 'discord-unavailable' }
  }

  if (roster.ids.size === 0) {
    console.warn(
      `discord officers: standing down — nobody in the guild carries role ${officerRoleId}. A role id that does not exist looks exactly like this, so nothing is changed.`,
    )
    return { ...nothing, skipped: 'no-role-holders' }
  }

  // `ADMIN` is excluded in the `where` of both queries rather than by a check
  // in the loop below, so a bug in the matching logic cannot reach an admin row
  // at all.
  const [risers, sitting] = await Promise.all([
    prisma.user.findMany({
      where: {
        role: { in: [UserRole.MEMBER, UserRole.GUEST] },
        OR: [
          { discordId: { in: [...roster.ids] } },
          { discordUsername: { in: [...roster.byHandle.keys()] } },
        ],
      },
      select: {
        id: true,
        discordId: true,
        discordUsername: true,
        joinedAt: true,
      },
    }),
    prisma.user.findMany({
      where: {
        role: UserRole.OFFICER,
        // Officers the site has no way to look up in the guild are left alone.
        // The analogue of `duesPaidThrough: { not: null }` in the dues sweep: an
        // appointment made outside this loop is not this loop's to undo.
        OR: [{ discordId: { not: null } }, { discordUsername: { not: null } }],
      },
      select: {
        id: true,
        fullName: true,
        discordId: true,
        discordUsername: true,
        duesPaidThrough: true,
      },
    }),
  ])

  /**
   * One predicate, both directions.
   *
   * Computing "holds the role" differently for promotion and demotion is how a
   * row whose stored `discordId` is stale but whose handle still matches gets
   * promoted and demoted on alternate sweeps, for ever.
   */
  const holds = (user: {
    discordId: string | null
    discordUsername: string | null
  }) =>
    (user.discordId !== null && roster.ids.has(user.discordId)) ||
    (user.discordUsername !== null &&
      roster.byHandle.has(user.discordUsername.toLowerCase()))

  const leaving = sitting.filter((user) => !holds(user))

  if (sitting.length > 0 && leaving.length === sitting.length) {
    console.warn(
      `discord officers: standing down — not one of the ${sitting.length} sitting officers carries role ${officerRoleId}. That is a configuration problem, not a board that resigned.`,
    )
    return { ...nothing, skipped: 'no-overlap' }
  }

  let promoted = 0

  for (const user of risers) {
    // Guarded on the role, the way `demoteIfLapsed` guards its write, so two
    // instances sweeping at once write once — and so `ADMIN` is refused a
    // second time at the write itself.
    const { count } = await prisma.user.updateMany({
      where: { id: user.id, role: { in: [UserRole.MEMBER, UserRole.GUEST] } },
      data: {
        role: UserRole.OFFICER,
        // Same rule and the same reason as `membershipUpdateFor`: an officer
        // with no `joinedAt` prints a blank year on their public profile.
        ...(user.joinedAt === null ? { joinedAt: now } : {}),
      },
    })

    if (count === 0) continue
    promoted++

    // Backfilled on the way past, the way `recipientFor` does it — but free
    // here, because the roster entry that matched already carries the id. Kept
    // best-effort for the same reason: `discordId` is unique, and a handle that
    // resolves to an account another row already claims must not take the
    // promotion down with it.
    if (user.discordId === null && user.discordUsername !== null) {
      const id = roster.byHandle.get(user.discordUsername.toLowerCase())
      if (id) {
        try {
          await prisma.user.update({ where: { id: user.id }, data: { discordId: id } })
        } catch (error) {
          console.error(`discord officers: could not store id for ${user.id}`, error)
        }
      }
    }
  }

  let demoted = 0

  for (const user of leaving) {
    const target = await standingRole(user.duesPaidThrough, now)

    const { count } = await prisma.user.updateMany({
      where: { id: user.id, role: UserRole.OFFICER },
      data: { role: target },
    })

    if (count === 0) continue
    demoted++

    // Losing a permission level gets a line with a name on it. Promotions can
    // be quiet; this is the one somebody comes looking for an explanation of.
    console.warn(
      `discord officers: ${user.fullName} no longer carries the officer role and is now ${target}`,
    )
  }

  return { promoted, demoted }
}
