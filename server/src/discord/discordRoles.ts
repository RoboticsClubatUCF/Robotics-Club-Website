import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { prisma } from '../core/db.js'
import {
  addGuildRole,
  guildMemberRoles,
  guildRoles,
  guildRoster,
  memberRoleId,
  officerAlumniRoleId,
  officerRoleId,
  projectLeadRoleId,
  removeGuildRole,
  roleSyncDryRun,
  teamLeadRoleId,
  type GuildRoster,
} from './discord.js'
import { recipientFor } from './discordRecipient.js'
import { ProjectMemberRank } from '../generated/prisma/enums.js'

/**
 * Giving people the Discord roles the site says they should have.
 *
 * The mirror image of `discordOfficers.ts`, and deliberately a separate file because
 * they point in opposite directions: that one reads the guild and writes Postgres,
 * this one reads Postgres and writes the guild.
 *
 * Every role has exactly one owner, and that's the rule the design rests on. Two loops
 * pointed at one role would fight every ten minutes, each undoing the other, and the
 * symptom would be a role that flickers rather than an error anybody could find.
 *
 *   - Officers belongs to Discord. Nothing here reads or writes it — the bot couldn't
 *     anyway, since its own role sits below Officers.
 *   - Members, Project Leads, Team Leads and each project's own role belong to the
 *     site. Hand-editing one in Discord is undone on the next sweep.
 *   - Everything else in the guild — pronouns, majors, committees, Server Booster,
 *     Faculty — belongs to nobody here and is never touched.
 *
 * Ways it refuses to run, all the same worry: that a bad minute quietly strips a role
 * off the whole club.
 *
 *   1. Nothing configured. No queries, no calls. This is how it ships.
 *   2. The guild couldn't be read. Write nothing — a half-read roster is
 *      indistinguishable from everybody having lost everything.
 *   3. Anybody the site can't match is invisible, in either direction, ever. There are
 *      people in the club's Discord who never signed up and they keep what they have.
 *   4. Overshoot. If a sweep would take one role off more than a quarter of the matched
 *      holders, that role stands down for the sweep and says so by name.
 *   5. A write budget. Fifty a sweep, paced, so a large first reconcile converges over
 *      a few sweeps rather than hammering the API.
 *
 * `DISCORD_ROLE_SYNC_DRY_RUN` computes all of it and writes none of it, which is how
 * the club should read the first sweep before trusting it.
 */

/**
 * The project form's Discord role field, spread into all three write schemas so they
 * can't drift. Nullable as well as optional: clearing the field is a thing a lead
 * does, and `undefined` already means "leave it alone".
 */
export const discordRoleField = {
  discordRoleId: z
    .string()
    .trim()
    .regex(/^\d{17,20}$/, 'A Discord role id is 17-20 digits, nothing else.')
    .nullable()
    .optional(),
}

/**
 * The club-wide roles a project's crew role may never be, and what to call each one
 * when refusing it.
 *
 * A project's role is handed out and taken back as people join and leave it, which is
 * exactly what makes pointing one at a club-wide role a disaster rather than a
 * mistake: set a project's role to Members and the first person to leave that project
 * loses their membership role in the guild. The role sweep would then fight the
 * project sync over the same role every ten minutes.
 *
 * Officers is here even though it sits above the bot and Discord refuses the write:
 * the refusal is silent, and a project quietly failing every role write for ever isn't
 * a better outcome than a 422. Officer Alumni is here because it's read-only by design.
 */
const reservedRoles = (): { id: string; name: string }[] =>
  [
    { id: memberRoleId, name: 'Members' },
    { id: projectLeadRoleId, name: 'Project Lead' },
    { id: teamLeadRoleId, name: 'Team Lead' },
    { id: officerRoleId, name: 'Officers' },
    { id: officerAlumniRoleId, name: 'Officer Alumni' },
  ].filter((role): role is { id: string; name: string } => role.id !== null)

/**
 * Refuse a role id a project may not use.
 *
 * Two checks that fail for different reasons and at different times. It must not be
 * one of the club's own roles — read off `env`, so it costs nothing and holds while
 * Discord is down, which matters because it's the check that prevents damage. And it
 * must be a role that exists: Discord doesn't error on a wrong id, it matches nobody
 * silently for ever, so without this a transposed digit is a project whose crew role
 * never works.
 *
 * The second is skipped whenever Discord can't answer — an outage must not stop
 * somebody creating a project, and the sweep warns about an unmatched id later. The
 * first is not skipped for anything.
 */
export async function assertUsableRole(
  roleId: string | null | undefined,
): Promise<void> {
  if (!roleId) return

  const reserved = reservedRoles().find((role) => role.id === roleId)
  if (reserved) {
    throw new HTTPException(422, {
      message: `That is the club’s ${reserved.name} role, which the site hands out itself. A project’s role is added and removed as people join and leave it, so pointing one at a club-wide role would take ${reserved.name} off everybody who leaves. Give the project a role of its own.`,
    })
  }

  const known = await guildRoles()
  if (known.status !== 'ok') return

  if (!known.roles.has(roleId)) {
    throw new HTTPException(422, {
      message: 'No role with that id in the club’s Discord server.',
    })
  }
}

export interface RoleSyncReport {
  added: number
  removed: number
  /** Matched people the sweep considered. */
  people: number
  /** Set when nothing was attempted, and why. */
  skipped?: 'not-configured' | 'discord-unavailable'
  /** Roles whose removals were refused this sweep by the overshoot guard. */
  heldBack: string[]
  /** True when the write budget ran out and the rest waits for the next sweep. */
  budgetSpent: boolean
}

/**
 * Fifty a sweep, three hundred milliseconds apart — the pace the DM sweeps use, and
 * the shape Discord throttles hardest. Fifteen seconds of a ten-minute tick, and a
 * backlog of any size converges within the hour.
 */
const WRITE_BUDGET = 50
const WRITE_SPACING_MS = 300

/**
 * A quarter, or five, whichever is larger. The floor matters more than the fraction:
 * on a club this size a percentage alone would let "all three people who hold it"
 * through as ordinary turnover.
 */
const overshoots = (removing: number, holders: number): boolean =>
  removing > Math.max(5, holders * 0.25)

/** The club-wide roles that are configured, in a stable order for logging. */
const clubRoles = (): string[] =>
  [memberRoleId, projectLeadRoleId, teamLeadRoleId].filter(
    (id): id is string => id !== null,
  )

interface Standing {
  id: string
  fullName: string
  discordId: string | null
  discordUsername: string | null
  duesPaidThrough: Date | null
  /** Named `projects` because that's the relation on `User`, and a second spelling for
      one thing is how a select and its type drift apart. */
  projects: {
    rank: ProjectMemberRank
    project: { discordRoleId: string | null }
  }[]
}

/**
 * Every role this person should be carrying.
 *
 * All four rules are a union across their memberships, and that's load-bearing:
 * standing somebody down as lead of one project must not take the Project Leads role
 * while they still lead another, and leaving last semester's row of a build that runs
 * on must not take the crew role while they're on this semester's. Duplicating a
 * project makes the second ordinary rather than rare, which is why this is recomputed
 * whole every time rather than patched by delta.
 */
export function desiredRoles(user: Standing, now: Date): Set<string> {
  const wanted = new Set<string>()

  // A date, still running — which is exactly what `membershipStanding().hasAccess`
  // means, and this file is where that rule was written down first. The site used to be
  // looser, so the Discord role and the website disagreed for about three months a
  // year; the website came to meet this. Kept as the plain comparison because it needs
  // no calendar and this runs against every matched member on a sweep.
  if (
    memberRoleId !== null &&
    user.duesPaidThrough !== null &&
    user.duesPaidThrough > now
  ) {
    wanted.add(memberRoleId)
  }

  for (const membership of user.projects) {
    if (
      projectLeadRoleId !== null &&
      membership.rank === ProjectMemberRank.PROJECT_LEAD
    ) {
      wanted.add(projectLeadRoleId)
    }

    if (
      teamLeadRoleId !== null &&
      membership.rank === ProjectMemberRank.TEAM_LEAD
    ) {
      wanted.add(teamLeadRoleId)
    }

    if (membership.project.discordRoleId !== null) {
      wanted.add(membership.project.discordRoleId)
    }
  }

  return wanted
}

const standingSelect = {
  id: true,
  fullName: true,
  discordId: true,
  discordUsername: true,
  duesPaidThrough: true,
  projects: {
    select: { rank: true, project: { select: { discordRoleId: true } } },
  },
} as const

/**
 * The roles this sync is responsible for: the configured club-wide ones, plus every
 * role any project claims. Nothing outside this set is ever removed from anybody.
 */
async function managedRoles(): Promise<Set<string>> {
  const projects = await prisma.project.findMany({
    where: { discordRoleId: { not: null } },
    select: { discordRoleId: true },
    distinct: ['discordRoleId'],
  })

  return new Set([
    ...clubRoles(),
    ...projects.map((project) => project.discordRoleId as string),
  ])
}

/** Whether there is anything at all to sync. Cheap, and checked before any call. */
async function configured(): Promise<boolean> {
  if (clubRoles().length > 0) return true

  return (
    (await prisma.project.count({ where: { discordRoleId: { not: null } } })) > 0
  )
}

/** The snowflake this person is reachable at in the guild, or null. */
function snowflakeFor(user: Standing, roster: GuildRoster): string | null {
  if (user.discordId !== null && roster.byId.has(user.discordId)) {
    return user.discordId
  }

  if (user.discordUsername !== null) {
    return roster.idByHandle.get(user.discordUsername.toLowerCase()) ?? null
  }

  return null
}

interface Change {
  userId: string
  fullName: string
  snowflake: string
  roleId: string
  add: boolean
}

/** The whole diff for one person, given what the guild says they carry. */
function changesFor(
  user: Standing,
  snowflake: string,
  held: string[],
  managed: Set<string>,
  now: Date,
): Change[] {
  const wanted = desiredRoles(user, now)
  const carrying = new Set(held)
  const changes: Change[] = []

  for (const roleId of wanted) {
    if (!carrying.has(roleId)) {
      changes.push({
        userId: user.id,
        fullName: user.fullName,
        snowflake,
        roleId,
        add: true,
      })
    }
  }

  for (const roleId of carrying) {
    // The managed check is the whole safety of this loop: a role nobody here owns is not
    // a role this may take away.
    if (managed.has(roleId) && !wanted.has(roleId)) {
      changes.push({
        userId: user.id,
        fullName: user.fullName,
        snowflake,
        roleId,
        add: false,
      })
    }
  }

  return changes
}

/**
 * One person, right now.
 *
 * Fire-and-forget from wherever their standing just changed, so paying dues or being
 * appointed a lead shows up in Discord in seconds rather than at the next sweep. It
 * reads that one member rather than the guild, so it costs two calls and can't be the
 * thing that makes a request slow.
 *
 * Deliberately silent about most failures: the reconciler behind this will put right
 * anything a dropped call left wrong.
 */
export async function syncUserRoles(
  userId: string,
  reason: string,
  now: Date = new Date(),
): Promise<void> {
  if (!(await configured())) return

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: standingSelect,
  })

  if (!user) return

  // Resolves the handle if that's all we have, and backfills `discordId` on the way —
  // the same helper the DM sweeps use, and for the same reason: resolving is free of
  // side effects, so a Discord outage costs nothing but a delay.
  const snowflake = await recipientFor(user)
  if (snowflake === null) return

  const held = await guildMemberRoles(snowflake)
  if (held.status !== 'ok') return

  const managed = await managedRoles()
  const changes = changesFor(user, snowflake, held.roles, managed, now)

  // No overshoot guard here, on purpose. That guard exists to stop a bad read stripping
  // a role off the whole club; one person's four roles isn't that shape, and applying it
  // here would only refuse somebody's legitimate departure from everything at once.
  for (const change of changes) {
    await apply(change, reason)
    await pause()
  }
}

/**
 * Several people at once, sharing one guild walk.
 *
 * For the events that change a whole roster's standing in one go — a project or team
 * deleted, a project's Discord role set or cleared. Calling `syncUserRoles` in a loop
 * would pay two calls per person and fire them all at once; a twenty-member project
 * would be forty simultaneous requests. One walk and a serial diff is cheaper from
 * about three people upwards.
 */
export async function syncUsersRoles(
  userIds: string[],
  reason: string,
  now: Date = new Date(),
): Promise<void> {
  if (userIds.length === 0) return
  if (!(await configured())) return

  const users = await prisma.user.findMany({
    where: {
      id: { in: userIds },
      OR: [{ discordId: { not: null } }, { discordUsername: { not: null } }],
    },
    select: standingSelect,
  })

  if (users.length === 0) return

  const result = await guildRoster()
  if (result.status !== 'ok') return

  const managed = await managedRoles()

  for (const user of users) {
    const snowflake = snowflakeFor(user, result.roster)
    if (snowflake === null) continue

    const changes = changesFor(
      user,
      snowflake,
      result.roster.byId.get(snowflake) ?? [],
      managed,
      now,
    )

    for (const change of changes) {
      await apply(change, reason)
      await pause()
    }
  }
}

/**
 * `syncUserRoles`, started and not waited for.
 *
 * The shape every mutation site uses, and one function rather than eleven copies of
 * `void … .catch(…)` so the promise can never be accidentally awaited into a response.
 * Nothing on the request path may depend on Discord answering: the member has already
 * paid, or joined, or been stood down, and the sweep puts right anything a dropped
 * call left wrong.
 */
export function pushRoles(userId: string, reason: string): void {
  void syncUserRoles(userId, reason).catch((error: unknown) => {
    console.error(`discord roles: push for ${userId} failed`, error)
  })
}

/**
 * Take back every role the site handed out, from somebody it no longer knows.
 *
 * The one case `syncUserRoles` structurally can't cover: it reads the account out of
 * Postgres and returns early when there's no row, and the reconciler skips anybody the
 * site can't match. So a deleted account is invisible to both, and would go on carrying
 * Members and Project Leads for ever.
 *
 * Called from the account deletion route with the snowflake read before the row went,
 * which is why this takes one rather than looking it up.
 *
 * It removes only roles in the managed set. Somebody leaving the website isn't somebody
 * leaving the Discord.
 */
export async function stripManagedRoles(
  snowflake: string,
  fullName: string,
  reason: string,
): Promise<void> {
  const held = await guildMemberRoles(snowflake)
  if (held.status !== 'ok') return

  const managed = await managedRoles()

  for (const roleId of held.roles) {
    if (!managed.has(roleId)) continue

    await apply(
      { userId: '(deleted)', fullName, snowflake, roleId, add: false },
      reason,
    )
    await pause()
  }
}

/** `stripManagedRoles`, started and not waited for — the shape `pushRoles` uses, and
    for the same reason: nothing on the request path may depend on Discord answering. */
export function pushRoleStrip(
  snowflake: string,
  fullName: string,
  reason: string,
): void {
  void stripManagedRoles(snowflake, fullName, reason).catch((error: unknown) => {
    console.error(`discord roles: strip for ${fullName} failed`, error)
  })
}

/** The same, for a whole roster at once. See `syncUsersRoles`. */
export function pushRolesFor(userIds: string[], reason: string): void {
  void syncUsersRoles(userIds, reason).catch((error: unknown) => {
    console.error(`discord roles: push for ${userIds.length} people failed`, error)
  })
}

/**
 * The gap between writes. Skipped entirely on a dry run, which issues no requests —
 * waiting anyway would make the one mode somebody runs interactively the slowest.
 */
const pause = () =>
  roleSyncDryRun
    ? Promise.resolve()
    : new Promise((resolve) => setTimeout(resolve, WRITE_SPACING_MS))

async function apply(change: Change, reason: string): Promise<boolean> {
  const note = `RCCF website: ${reason}`

  if (roleSyncDryRun) {
    console.log(
      `discord roles [dry run]: would ${change.add ? 'add' : 'remove'} ${change.roleId} ${change.add ? 'to' : 'from'} ${change.fullName} — ${reason}`,
    )
    return true
  }

  const result = change.add
    ? await addGuildRole(change.snowflake, change.roleId, note)
    : await removeGuildRole(change.snowflake, change.roleId, note)

  return result.status === 'done'
}

/**
 * Everybody, on the ten-minute tick.
 *
 * This is what makes the write-through calls optional rather than load-bearing: a
 * dropped call, a Discord outage, a bulk `updateMany` with no per-row hook — all put
 * right here. `sweepLapsedMembers` demotes in bulk and this runs directly after it in
 * the same tick, which is why that sweep needed no changes of its own.
 */
export async function sweepDiscordRoles(
  now: Date = new Date(),
): Promise<RoleSyncReport> {
  const nothing = { added: 0, removed: 0, people: 0, heldBack: [], budgetSpent: false }

  if (!(await configured())) {
    return { ...nothing, skipped: 'not-configured' }
  }

  const result = await guildRoster()

  if (result.status !== 'ok') {
    if (result.status === 'unavailable') {
      console.warn(
        `discord roles: standing down — the guild could not be read (${result.reason})`,
      )
    }
    return { ...nothing, skipped: 'discord-unavailable' }
  }

  await warnAboutUnknownRoles()

  const managed = await managedRoles()

  // Only rows with something to match on. Everyone else is invisible to this by
  // construction rather than by a check inside the loop.
  const users = await prisma.user.findMany({
    where: {
      OR: [{ discordId: { not: null } }, { discordUsername: { not: null } }],
    },
    select: standingSelect,
  })

  const changes: Change[] = []
  let people = 0

  for (const user of users) {
    const snowflake = snowflakeFor(user, result.roster)
    if (snowflake === null) continue

    people++
    changes.push(
      ...changesFor(
        user,
        snowflake,
        result.roster.byId.get(snowflake) ?? [],
        managed,
        now,
      ),
    )
  }

  const heldBack = holdBackOvershoots(changes, result.roster, managed)
  const wanted = changes.filter(
    (change) => change.add || !heldBack.includes(change.roleId),
  )

  let added = 0
  let removed = 0
  let budgetSpent = false

  for (const change of wanted) {
    if (added + removed >= WRITE_BUDGET) {
      budgetSpent = true
      break
    }

    if (await apply(change, reasonFor(change))) {
      if (change.add) added++
      else removed++
    }

    await pause()
  }

  return { added, removed, people, heldBack, budgetSpent }
}

/**
 * A generic sentence, because the sweep is reconciling rather than reacting — it
 * doesn't know which of the things that changed is the reason. The write-through calls
 * pass something specific.
 */
const reasonFor = (change: Change): string =>
  change.add ? 'matching the website' : 'no longer applies on the website'

/**
 * Roles this sweep is about to strip off too many people at once.
 *
 * The proportion is measured against the matched holders rather than the whole guild,
 * because unmatched people aren't candidates and counting them would dilute the guard
 * into never firing.
 */
function holdBackOvershoots(
  changes: Change[],
  roster: GuildRoster,
  managed: Set<string>,
): string[] {
  const removals = new Map<string, number>()

  for (const change of changes) {
    if (change.add) continue
    removals.set(change.roleId, (removals.get(change.roleId) ?? 0) + 1)
  }

  const held: string[] = []

  for (const [roleId, count] of removals) {
    if (!managed.has(roleId)) continue

    let holders = 0
    for (const roles of roster.byId.values()) {
      if (roles.includes(roleId)) holders++
    }

    if (overshoots(count, holders)) {
      console.warn(
        `discord roles: standing down on ${roleId} — this sweep would take it off ${count} of ${holders} holders, which is a configuration problem rather than turnover`,
      )
      held.push(roleId)
    }
  }

  return held
}

/**
 * Say something about a configured role that isn't a role.
 *
 * The one failure mode nothing else can see: a mistyped snowflake isn't an error at
 * Discord's API, it simply matches nobody for ever. The project form checks a pasted id
 * at save time, but a role deleted afterwards only shows up here.
 */
async function warnAboutUnknownRoles(): Promise<void> {
  const known = await guildRoles()
  if (known.status !== 'ok') return

  const configuredIds = await managedRoles()

  for (const roleId of configuredIds) {
    if (!known.roles.has(roleId)) {
      console.warn(
        `discord roles: ${roleId} is configured but is not a role in this guild — nothing will ever match it`,
      )
    }
  }
}
