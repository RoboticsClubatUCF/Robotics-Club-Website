import { prisma } from '../core/db.js'
import {
  checkDiscordHandle,
  guildMemberRoles,
  guildRoles,
  membersWithRole,
  officerRoleId,
  officerSyncConfigured,
} from './discord.js'
import { OfficerTermSource, UserRole } from '../generated/prisma/enums.js'
import { membershipStanding } from '../membership/semester.js'

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
 * ## Two entry points, and two columns
 *
 * `syncDiscordOfficers` is the ten-minute sweep across the whole guild.
 * `refreshOfficerStanding` is one person on the spot — sign-in, and the "who am
 * I" read behind every page — so a role handed over or taken away in Discord
 * lands on the next page load rather than up to ten minutes later. **Both
 * promote and both demote.** The per-user one can only do that safely because
 * it first checks the configured role id against the guild's own role list; its
 * comment has the argument in full, and without that guard it could not demote
 * at all.
 *
 * Both maintain **two** things, and keeping them apart is the point:
 *
 *   - **`User.role`** — the permission ladder, `OFFICER` ↔ whatever dues say.
 *     `ADMIN` is never written here, in either direction.
 *   - **`OfficerTerm`** — the tenure. Open (`endedAt` null) is what "on the
 *     board" means, and it is written for **everyone including admins**. That
 *     is the whole reason it is a separate table: `UserRole` has one slot per
 *     person and `ADMIN` outranks `OFFICER`, so the ladder cannot say "an admin
 *     who is also an officer" and a term can. It is also what puts an
 *     ex-officer on `/officers` rather than making them vanish.
 *
 * Only `DISCORD`-sourced terms are closed by either. The faculty advisor sits
 * on the board carrying no Discord role at all.
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
 *      important one — `officerRoleExists` is the per-user answer to the same
 *      worry. **A wrong role id is not an error at Discord's API** — it
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
  /** Terms opened and closed. Separate from the two above because an `ADMIN`
      moves these and never those. */
  opened: number
  closed: number
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
 * would ever move them again — they would count towards the club's active
 * membership for ever, and carry the Discord Members role with it, having
 * never paid. `GUEST` for everybody takes club membership away from somebody
 * who paid and merely stepped off the board.
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

// ------------------------------------------------------------------ tenure

/**
 * Opening and closing a term, which is the half of this that is *not* about
 * `User.role`.
 *
 * An open `OfficerTerm` — `endedAt` null — is what "currently on the board"
 * means. It is a separate axis from the permission ladder on purpose, and the
 * case that forces it is the admin who is also an officer: `UserRole` has one
 * slot per person and `ADMIN` outranks `OFFICER`, so the ladder simply cannot
 * hold both facts. A term can, and the sync writes it for admins exactly as it
 * does for anybody else while never touching their `role`.
 *
 * **The sync only ever closes what the sync opened**, hence
 * `source: 'DISCORD'` on both sides of this. A `MANUAL` term is somebody's
 * deliberate appointment on the roles desk — the faculty advisor sits on the
 * board carrying no Discord role at all — and closing those would stand them
 * down on the first pass. Same rule as the dues sweep only touching rows that
 * already have a `duesPaidThrough`: an appointment made outside a loop is not
 * that loop's to undo.
 */
async function openTerm(
  user: { id: string; fullName: string },
  now: Date,
): Promise<boolean> {
  // Check-then-act rather than a constraint, because there deliberately is not
  // one: two sweeps racing would leave two open terms, both visible and either
  // closable, which is the trade written down in `schema.prisma`.
  const held = await prisma.officerTerm.findFirst({
    where: { userId: user.id, endedAt: null },
    select: { id: true },
  })

  if (held) return false

  await prisma.officerTerm.create({
    data: {
      userId: user.id,
      fullName: user.fullName,
      // No seat. Discord says *that* somebody is on the board; which chair they
      // sit in is an officer's decision on the roles desk, and inventing one
      // here would put them in somebody else's.
      position: null,
      startedAt: now,
      source: OfficerTermSource.DISCORD,
    },
  })

  return true
}

async function closeTerm(
  userId: string,
  now: Date,
  reason: string,
): Promise<boolean> {
  const { count } = await prisma.officerTerm.updateMany({
    where: { userId, endedAt: null, source: OfficerTermSource.DISCORD },
    data: { endedAt: now, endedReason: reason },
  })

  return count > 0
}

const LOST_THE_ROLE = 'Lost the officer role in Discord'

/**
 * Whether the configured officer role is a real role in the club's guild.
 *
 * **This is what makes demoting one person at a time safe**, and without it the
 * live half of this file could not demote at all. From a single member's role
 * list, "this person is not an officer" and "the role id in `.env` is a typo or
 * names a role somebody deleted" are byte-for-byte identical — Discord returns
 * neither an error nor a hint for the second, which is why the sweep below has
 * three separate refusals built on that one fact. A per-user check that demoted
 * without this would stand the whole board down one sign-in at a time.
 *
 * `guildRoles()` answers it directly and cheaply: one call, every role in the
 * guild by id. Cached because sign-in and the "who am I" read both reach it and
 * a role list does not change minute to minute. **Only a definite `no` is
 * cached as false** — an unreachable Discord is not evidence the role is gone,
 * and caching that would turn one bad minute into ten minutes of refusing to
 * demote for a reason nobody could see.
 */
const ROLE_CHECK_TTL_MS = 10 * 60 * 1000

let roleSeen: { at: number; exists: boolean } | null = null

export function forgetRoleCheck(): void {
  roleSeen = null
}

async function officerRoleExists(now: Date): Promise<boolean | null> {
  if (officerRoleId === null) return false

  if (roleSeen && now.getTime() - roleSeen.at < ROLE_CHECK_TTL_MS) {
    return roleSeen.exists
  }

  const roles = await guildRoles()

  // Not an answer either way. The caller must not demote on it.
  if (roles.status !== 'ok') return null

  const exists = roles.roles.has(officerRoleId)
  roleSeen = { at: now.getTime(), exists }

  if (!exists) {
    console.warn(
      `discord officers: role ${officerRoleId} is not a role in this guild — nobody will be stood down until that is corrected.`,
    )
  }

  return exists
}

export async function syncDiscordOfficers(
  now: Date = new Date(),
): Promise<OfficerSyncReport> {
  const nothing = { promoted: 0, demoted: 0, opened: 0, closed: 0 }

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

  // `ADMIN` is excluded in the `where` of both *role* queries rather than by a
  // check in the loops below, so a bug in the matching logic cannot reach an
  // admin's `role` at all. Their **tenure** is maintained by the third query,
  // which is a different column and deliberately does include them.
  const [risers, sitting, tenured] = await Promise.all([
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
    /**
     * Everyone the guild could name, whatever their role — this is the query
     * that keeps `OfficerTerm` in step, and the one an `ADMIN` appears in.
     *
     * Tenure and permission are different questions with different answers, and
     * an admin is exactly where they come apart: `UserRole` has one slot per
     * person and `ADMIN` outranks `OFFICER`, so an admin who also sits on the
     * board cannot be said on the ladder at all. It can be said here.
     */
    prisma.user.findMany({
      where: {
        OR: [{ discordId: { not: null } }, { discordUsername: { not: null } }],
      },
      select: {
        id: true,
        fullName: true,
        discordId: true,
        discordUsername: true,
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

  /**
   * And the tenure, for everybody the guild can name — admins included, whose
   * `role` neither loop above touched.
   *
   * This is what puts an ex-officer on the archive instead of simply making
   * them vanish from the board. It runs after the role writes rather than
   * beside them so that a row promoted a moment ago is seen as promoted; the
   * two are independent columns, but reading them in a settled order is what
   * keeps the logs comprehensible.
   *
   * Only `DISCORD` terms are closed — `closeTerm` says why.
   */
  let opened = 0
  let closed = 0

  for (const user of tenured) {
    if (holds(user)) {
      if (await openTerm(user, now)) opened++
    } else if (await closeTerm(user.id, now, LOST_THE_ROLE)) {
      closed++
    }
  }

  return { promoted, demoted, opened, closed }
}

// ------------------------------------------------- one person, on the spot

/**
 * How long a single answer is reused before Discord is asked again.
 *
 * `GET /api/auth/me` runs on every page load of every signed-in browser, so
 * without this a busy afternoon is one Discord call per navigation. In memory
 * and per process on purpose: it is a rate limiter, not a record. Losing it on
 * deploy costs one extra call per person, and two instances each keeping their
 * own copy is two calls rather than one — both are fine, and neither is worth a
 * column or a cache server.
 */
const REFRESH_EVERY_MS = 5 * 60 * 1000

const lastChecked = new Map<string, number>()

/** Exported for the tests, which must not inherit a previous case's answer. */
export function forgetOfficerChecks(): void {
  lastChecked.clear()
}

export interface OfficerRefreshReport {
  promoted: boolean
  /** True when the role, the term, or both were taken away. */
  demoted: boolean
  /** Set when nothing was written, and why. */
  skipped?:
    | 'not-configured'
    | 'not-eligible'
    | 'throttled'
    | 'unidentifiable'
    | 'discord-unavailable'
    | 'without-role'
    /** The configured role id is not a role in the guild, so "they don't carry
        it" says nothing about them. Nobody is stood down on this. */
    | 'role-missing'
}

/**
 * Follow the officer role for **one** person, now, rather than at the next
 * sweep.
 *
 * The sweep runs every ten minutes, which is fine for a board that changes
 * twice a year and useless for the person it just changed for: somebody handed
 * the role in Discord and told it is done signs in, finds no officer desks, and
 * reports the site as broken. Somebody stood down keeps their desks for ten
 * minutes, which is worse than untidy. This closes both windows for the one
 * account that is asking — sign-in, and the "who am I" read behind every page —
 * at the cost of one member lookup rather than a walk of the whole guild.
 *
 * ## Demoting one person needs evidence the role is real
 *
 * Carrying the role is self-evident: the guild says this account holds it, and
 * nothing else could change what that means. **Not** carrying it is not
 * self-evident at all — a mistyped role id, a role somebody deleted, and a
 * person who was never an officer are byte-for-byte identical from one member's
 * role list, which is the failure the sweep has three separate refusals to
 * avoid. So this asks the question directly instead of inferring it:
 * `officerRoleExists` checks the configured id against the guild's own role
 * list before anybody is stood down, and a `null` from it — Discord unreachable
 * — is not evidence either way and refuses too.
 *
 * What is left after that guard is the honest case: the role exists, this
 * account does not carry it, so they are not an officer.
 *
 * ## Role and tenure move separately, which is what admits an admin
 *
 * `role` is the permission ladder and has one slot, with `ADMIN` above
 * `OFFICER` — so it cannot say "an admin who is also an officer". The term can.
 * An admin gains and loses a term here exactly as anybody else does while their
 * `role` is never written, which keeps the "`ADMIN` is a human in Prisma
 * Studio, in both directions" invariant whole.
 *
 * Nothing is pushed back to Discord; `sweepDiscordRoles` reconciles what the
 * club's members should carry on the tick after any of this.
 */
export async function refreshOfficerStanding(
  userId: string,
  { force = false, now = new Date() }: { force?: boolean; now?: Date } = {},
): Promise<OfficerRefreshReport> {
  const nothing = { promoted: false, demoted: false }

  if (!officerSyncConfigured || officerRoleId === null) {
    return { ...nothing, skipped: 'not-configured' }
  }

  if (!force) {
    const seen = lastChecked.get(userId)
    if (seen !== undefined && now.getTime() - seen < REFRESH_EVERY_MS) {
      return { ...nothing, skipped: 'throttled' }
    }
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      fullName: true,
      role: true,
      discordId: true,
      discordUsername: true,
      joinedAt: true,
      duesPaidThrough: true,
      officerTerms: {
        where: { endedAt: null },
        select: { id: true, source: true },
        take: 1,
      },
    },
  })

  if (!user) return { ...nothing, skipped: 'not-eligible' }

  const open = user.officerTerms[0] ?? null

  /**
   * Whether the *role* column is somewhere this may not write.
   *
   * `ADMIN` is above `OFFICER` on the ladder and is a human's decision in both
   * directions; an `OFFICER` is already where a promotion would put them. The
   * tenure half below runs regardless, which is the admin-and-officer case.
   *
   * **There is deliberately no early exit for "already an officer".** There was
   * one while this could only promote — a sitting officer had nothing to gain,
   * so asking Discord about them was waste. Now that it demotes, they are
   * precisely the people worth asking about: skipping them would mean an
   * ex-officer keeps their desks until the sweep notices. The throttle is what
   * keeps that affordable.
   */
  const roleSettled =
    user.role === UserRole.OFFICER || user.role === UserRole.ADMIN

  // Somebody with neither a snowflake nor a handle cannot be looked up. Not an
  // error — most of the roster predates the signup check — and the sweep is no
  // better off with them either.
  if (user.discordId === null && user.discordUsername === null) {
    return { ...nothing, skipped: 'unidentifiable' }
  }

  // Stamped before the call rather than after it, so a Discord outage cannot
  // turn every page load into a five-second timeout for as long as it lasts.
  lastChecked.set(userId, now.getTime())

  /**
   * Two ways in, one call either way.
   *
   * The snowflake is the direct lookup and is what every account created since
   * the signup check carries. A handle-only row — the seed, anything an officer
   * typed — goes through the same search signup itself uses, which answers with
   * the id *and* the roles together, so resolving the handle costs nothing
   * extra. Neither path walks the guild.
   *
   * **Not being in the guild is an empty role list, not a failure.** Somebody
   * who has left the club's Discord is not one of its officers, and the guard
   * below is what makes acting on that safe.
   */
  let roles: string[]
  let resolvedId: string | null = null

  if (user.discordId !== null) {
    const held = await guildMemberRoles(user.discordId)

    if (held.status === 'ok') roles = held.roles
    else if (held.status === 'not_found') roles = []
    else return { ...nothing, skipped: 'discord-unavailable' }
  } else {
    const check = await checkDiscordHandle(user.discordUsername ?? '')

    if (check.status === 'connected') {
      roles = check.roles
      resolvedId = check.id
    } else if (check.status === 'not_found') roles = []
    else return { ...nothing, skipped: 'discord-unavailable' }
  }

  // --------------------------------------------------------- carries the role

  if (roles.includes(officerRoleId)) {
    let promoted = false

    // Guarded on the role at the write, exactly as the sweep guards its own, so
    // two of these racing write once and `ADMIN` is refused a second time here.
    if (!roleSettled) {
      const { count } = await prisma.user.updateMany({
        where: { id: user.id, role: { in: [UserRole.MEMBER, UserRole.GUEST] } },
        data: {
          role: UserRole.OFFICER,
          // Same rule and the same reason as the sweep: an officer with no
          // `joinedAt` prints a blank year on their public profile.
          ...(user.joinedAt === null ? { joinedAt: now } : {}),
        },
      })
      promoted = count > 0
    }

    // The tenure half, which runs for an `ADMIN` too.
    if (!open) await openTerm(user, now)

    // Best-effort and after the promotion, for the reason the sweep gives:
    // `discordId` is unique, and a handle resolving to an account another row
    // already claims must not take the promotion down with it.
    if (resolvedId !== null) {
      try {
        await prisma.user.update({
          where: { id: user.id },
          data: { discordId: resolvedId },
        })
      } catch (error) {
        console.error(`discord officers: could not store id for ${user.id}`, error)
      }
    }

    if (promoted) {
      console.log(
        `discord officers: ${user.fullName} carries the officer role and was promoted on sign-in`,
      )
    }

    return { promoted, demoted: false }
  }

  // ----------------------------------------------------- does not carry it

  // Nothing to take away, so nothing to prove either.
  if (!open && user.role !== UserRole.OFFICER) {
    return { ...nothing, skipped: 'without-role' }
  }

  // The guard the whole live half rests on. `null` is Discord not answering,
  // which is not evidence the role is gone.
  const exists = await officerRoleExists(now)

  if (exists !== true) {
    return {
      ...nothing,
      skipped: exists === null ? 'discord-unavailable' : 'role-missing',
    }
  }

  let demoted = false

  // `ADMIN` is never written, in either direction. Their term still closes
  // below, which is what puts them on the archive.
  if (user.role === UserRole.OFFICER) {
    const target = await standingRole(user.duesPaidThrough, now)

    const { count } = await prisma.user.updateMany({
      where: { id: user.id, role: UserRole.OFFICER },
      data: { role: target },
    })

    demoted = count > 0

    if (demoted) {
      // Losing a permission level gets a line with a name on it, the same way
      // the sweep gives one. This is the one somebody comes looking for.
      console.warn(
        `discord officers: ${user.fullName} no longer carries the officer role and is now ${target}`,
      )
    }
  }

  // `MANUAL` terms are left alone — `closeTerm` says why, and this is what
  // keeps the faculty advisor on the board.
  const closed = await closeTerm(user.id, now, LOST_THE_ROLE)

  return { promoted: false, demoted: demoted || closed }
}
