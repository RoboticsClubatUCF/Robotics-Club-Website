import { prisma } from '../core/db.js'
import {
  alumniSyncConfigured,
  membersWithRole,
  officerAlumniRoleId,
} from './discord.js'

/**
 * Following the club's Discord **Officer Alumni** role.
 *
 * The same direction as `discordOfficers.ts` and for the same reason: the club
 * keeps this list in Discord and has kept it there for years, so the site reads
 * it rather than asking anybody to maintain the same names twice. Carry the
 * role and `/members` files you under ALUMNI; lose it and it does not.
 *
 * **`OfficerTerm` answers the same question now, and this is still not derived
 * from it.** It used to be unusable for this: it only knew about the people who
 * had rotated off *since the officer sync started*, a few months of a fifty-year
 * club, while the Discord role goes back as far as the server does. The officers
 * desk closed that gap — `/dashboard/officer/officers` writes closed terms by
 * hand, so the archive reaches as far back as somebody types — and `/members`
 * reads the two together: the ALUMNI chip is this flag **or** a term that has
 * ended, in `rosterStatus` in `routes/public/content.ts`.
 *
 * What has not changed is who writes the column. That is still this sweep and
 * only this sweep. The desk adds a *second source* to the read and not a second
 * writer, because a column with two owners is the failure the next section is
 * about, and an officer typing in the 2011 board must not make the next sweep
 * think the guild disagrees with it.
 *
 * ## One column, and it is not `active`
 *
 * This writes `User.officerAlumnus` and nothing else. Merging it into `active`
 * is the obvious shortcut and it is wrong twice over:
 *
 *   - **`active` already has an owner.** `membershipUpdateFor` in
 *     `routes/member/dues.ts` sets it back to `true` every time somebody pays.
 *     A sweep writing `false` here would be a second owner of one column, and
 *     the two would undo each other every ten minutes with nothing in any log
 *     to say why somebody kept reappearing.
 *   - **They are different facts.** A former president who still pays dues is a
 *     current member *and* an officer alumnus. One boolean cannot say that, and
 *     one of the twenty-seven people carrying this role in the club's guild
 *     carries the Officers role as well.
 *
 * ## Ways it refuses to run
 *
 * The officer sync's four refusals, minus the one that does not apply — there
 * is no "no overlap" case here because this sweep has no second signal to
 * disagree with.
 *
 *   1. **Not configured.** No role id, no queries, no calls. Unset is the
 *      default and it is how this ships.
 *   2. **The guild could not be read.** Write nothing. A half-read guild is
 *      indistinguishable from an empty one, and an empty one reads as "nobody
 *      is an alumnus any more".
 *   3. **Nobody holds the role.** Stand down unconditionally. **A wrong role id
 *      is not an error at Discord's API** — the guild comes back happily and
 *      the typo'd snowflake simply appears in nobody's `roles` array, so a
 *      misconfigured id, a deleted role and a genuinely empty list are
 *      byte-for-byte identical.
 *   4. **Clearing everybody.** If a sweep would take the flag off every person
 *      who currently carries it and mark nobody, that is the shape of a role
 *      that was renumbered rather than a club whose alumni all resigned.
 *
 * And anybody the site cannot match is invisible to it, in either direction —
 * the same rule the other two syncs follow. There are people in the club's
 * Discord who never signed up, and this never writes a row for them because
 * there is no row to write.
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
    // Candidates to mark. The `in` clauses are a pre-filter that keeps this off
    // the whole table; `holds` below is the authority on both directions.
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
    // Everybody currently flagged who the site could look up in the guild.
    // Somebody flagged with no Discord identity at all is left alone — the
    // analogue of `duesPaidThrough: { not: null }` in the dues sweep. Nothing
    // but this sweep sets the flag, so that row can only exist if their handle
    // was cleared afterwards, and guessing on their behalf is not this loop's
    // business.
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
   * Computing "holds the role" differently for marking and clearing is how a
   * row whose stored `discordId` is stale but whose handle still matches gets
   * marked and cleared on alternate sweeps, for ever. Lifted from
   * `discordOfficers.ts`, where the same bug was the same one sentence.
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

  // Refusal 4. Ordinary turnover — one or two people at a time, alongside
  // somebody new being marked — passes straight through.
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

  // Two bulk writes rather than a loop. Nothing follows from this column —
  // no Discord write, no role, no email — so there is no per-row hook to run
  // and no reason to pace anything.
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
