import { prisma } from '../core/db.js'
import {
  alumniSyncConfigured,
  membersWithRole,
  officerAlumniRoleId,
} from './discord.js'

/**
 * Following the club's Discord Officer Alumni role.
 *
 * The same direction as `discordOfficers.ts` and for the same reason: the club has kept
 * this list in Discord for years, so the site reads it rather than asking anybody to
 * maintain the same names twice. Carry the role and `/members` files you under ALUMNI.
 *
 * `OfficerTerm` answers the same question now, and this is still not derived from it. It
 * used to be unusable for this — it only knew about people who had rotated off since the
 * officer sync started — and the officers desk closed that gap. `/members` reads the two
 * together: the ALUMNI chip is this flag or a term that has ended, in `rosterStatus`.
 *
 * What hasn't changed is who writes the column: this sweep and only this sweep. The desk
 * adds a second source to the read and not a second writer, because a column with two
 * owners is the failure below.
 *
 * This writes `User.officerAlumnus` and nothing else. Merging it into `active` is the
 * obvious shortcut and it's wrong twice over. `active` already has an owner —
 * `membershipUpdateFor` sets it back to true on every payment, so the two would undo each
 * other every ten minutes. And they're different facts: a former president who still pays
 * dues is a current member and an officer alumnus.
 *
 * Ways it refuses to run — the officer sync's four, minus the one that doesn't apply:
 *
 *   1. Not configured. No role id, no queries, no calls.
 *   2. The guild couldn't be read. Write nothing: a half-read guild is indistinguishable
 *      from an empty one, and an empty one reads as "nobody is an alumnus any more".
 *   3. Nobody holds the role. A wrong role id isn't an error at Discord's API — the typo'd
 *      snowflake appears in nobody's `roles` array, so a misconfigured id, a deleted role
 *      and a genuinely empty list are identical.
 *   4. Clearing everybody. That's the shape of a role that was renumbered rather than a
 *      club whose alumni all resigned.
 *
 * And anybody the site can't match is invisible to it, in either direction.
 */
export interface AlumniSyncReport {
  /** Accounts newly flagged as officer alumni. */
  marked: number
  /** Accounts the flag came off. */
  cleared: number
  /** Set when nothing was attempted, and why. */
  skipped?: 'not-configured' | 'discord-unavailable' | 'no-role-holders'
  /** True when refusal 4 fired: every clear was refused this sweep. */
  heldBack?: boolean
}

export async function syncOfficerAlumni(): Promise<AlumniSyncReport> {
  const nothing = { marked: 0, cleared: 0 }

  if (!alumniSyncConfigured || officerAlumniRoleId === null) {
    return { ...nothing, skipped: 'not-configured' }
  }

  const roster = await membersWithRole(officerAlumniRoleId)

  if (roster.status !== 'ok') {
    console.warn(
      `discord alumni: standing down — the guild could not be read (${
        roster.status === 'unavailable' ? roster.reason : roster.status
      })`,
    )
    return { ...nothing, skipped: 'discord-unavailable' }
  }

  if (roster.ids.size === 0) {
    console.warn(
      `discord alumni: standing down — nobody in the guild carries role ${officerAlumniRoleId}. A role id that does not exist looks exactly like this, so nothing is changed.`,
    )
    return { ...nothing, skipped: 'no-role-holders' }
  }

  const [unflagged, flagged] = await Promise.all([
    // Candidates to mark. The `in` clauses are a pre-filter that keeps this off the whole
    // table; `holds` below is the authority on both directions.
    prisma.user.findMany({
      where: {
        officerAlumnus: false,
        OR: [
          { discordId: { in: [...roster.ids] } },
          { discordUsername: { in: [...roster.byHandle.keys()] } },
        ],
      },
      select: { id: true, discordId: true, discordUsername: true },
    }),
    // Everybody currently flagged who the site could look up in the guild. Somebody
    // flagged with no Discord identity at all is left alone — the analogue of
    // `duesPaidThrough: { not: null }` in the dues sweep. Nothing but this sweep sets the
    // flag, so that row can only exist if their handle was cleared afterwards.
    prisma.user.findMany({
      where: {
        officerAlumnus: true,
        OR: [{ discordId: { not: null } }, { discordUsername: { not: null } }],
      },
      select: { id: true, fullName: true, discordId: true, discordUsername: true },
    }),
  ])

  /**
   * One predicate, both directions.
   *
   * Computing "holds the role" differently for marking and clearing is how a row whose
   * stored `discordId` is stale but whose handle still matches gets marked and cleared on
   * alternate sweeps, for ever.
   */
  const holds = (user: {
    discordId: string | null
    discordUsername: string | null
  }) =>
    (user.discordId !== null && roster.ids.has(user.discordId)) ||
    (user.discordUsername !== null &&
      roster.byHandle.has(user.discordUsername.toLowerCase()))

  const marking = unflagged.filter(holds)
  const clearing = flagged.filter((user) => !holds(user))

  // Refusal 4. Ordinary turnover — one or two people at a time, alongside somebody new
  // being marked — passes straight through.
  if (
    clearing.length > 0 &&
    clearing.length === flagged.length &&
    marking.length === 0
  ) {
    console.warn(
      `discord alumni: standing down — this sweep would clear all ${flagged.length} officer alumni and mark nobody. That is a configuration problem, not a club that lost its history.`,
    )
    return { ...nothing, heldBack: true }
  }

  // Two bulk writes rather than a loop. Nothing follows from this column — no Discord
  // write, no role, no email — so there's no per-row hook and no reason to pace anything.
  const [marked, cleared] = await Promise.all([
    marking.length > 0
      ? prisma.user.updateMany({
          where: { id: { in: marking.map((user) => user.id) } },
          data: { officerAlumnus: true },
        })
      : Promise.resolve({ count: 0 }),
    clearing.length > 0
      ? prisma.user.updateMany({
          where: { id: { in: clearing.map((user) => user.id) } },
          data: { officerAlumnus: false },
        })
      : Promise.resolve({ count: 0 }),
  ])

  return { marked: marked.count, cleared: cleared.count }
}
