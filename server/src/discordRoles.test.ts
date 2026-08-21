import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from './db.js'
import { ProjectMemberRank, Season, UserRole } from './generated/prisma/enums.js'

/**
 * Handing out the Discord roles the site says people should have.
 *
 * **The dangerous direction.** `discordOfficers.test.ts` is the suite that can
 * damage the *database*; this is the one that can damage the club's actual
 * Discord server. Nothing here writes a row — the sweep only reads Postgres —
 * so there is no tripwire on roles or dues to build. What there is instead is a
 * total mock of `./discord.js`: every read and both writes are fakes, and the
 * development `.env` carries a live bot token for the club's real guild, so an
 * unmocked run would add and remove roles on real people's accounts.
 * `checkDiscordHandle` is in that list because `recipientFor` reaches for it on
 * a row that has a handle and no snowflake.
 *
 * **Three reads, and which one is used is itself under test.** The sweep walks
 * the whole guild once (`guildRoster`); the one-person path reads one member
 * (`guildMemberRoles`) because a walk per person would make deleting a
 * twenty-member project twenty walks; the bulk path shares a single walk across
 * a roster. Two tests below assert which of those was called and not just what
 * was written.
 *
 * **The second isolation is the stubbed roster**, and it is what keeps the
 * assertions honest rather than what keeps the club safe. The sweep considers
 * every user carrying a Discord identity, real ones included — but somebody
 * the roster does not mention is skipped before any change is computed, so a
 * roster containing only this suite's invented snowflakes means the only
 * changes it can produce are its own. A test at the bottom asserts exactly
 * that, because it is the property the whole design leans on.
 *
 * No clock to pin and no calendar to stub, which is a consequence of the rule
 * under test: the member role follows `duesPaidThrough` literally, so nothing
 * here asks `membershipStanding` and nothing depends on what month it is.
 */

const MEMBER_ROLE = '900000000000000001'
const LEAD_ROLE = '900000000000000002'
const TEAM_ROLE = '900000000000000003'
/** Two projects, one crew role — the multi-semester case. */
const CREW_ROLE = '900000000000000004'
const OTHER_CREW = '900000000000000005'
/** A role in the guild that this sync does not own and must never remove. */
const UNMANAGED = '900000000000000099'

const config = vi.hoisted(() => ({
  member: null as string | null,
  lead: null as string | null,
  team: null as string | null,
  dry: false,
}))

vi.mock('./discord.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./discord.js')>()),
  // Getters rather than values: every one of these is a module constant read
  // through a live binding at call time, so a getter is what lets one test run
  // with the member role configured and the next run with none of them.
  get memberRoleId() {
    return config.member
  },
  get projectLeadRoleId() {
    return config.lead
  },
  get teamLeadRoleId() {
    return config.team
  },
  get roleSyncDryRun() {
    return config.dry
  },
  guildRoster: vi.fn(),
  guildMemberRoles: vi.fn(),
  guildRoles: vi.fn(),
  // Mocked so `recipientFor` cannot reach the real guild for a handle-only
  // fixture. Every fixture below that goes through the one-person path carries
  // a snowflake, so this should never be consulted — answering `unchecked`
  // makes a test that accidentally relies on it fail rather than call out.
  checkDiscordHandle: vi.fn(() => Promise.resolve({ status: 'unchecked' as const })),
  addGuildRole: vi.fn(() => Promise.resolve({ status: 'done' as const })),
  removeGuildRole: vi.fn(() => Promise.resolve({ status: 'done' as const })),
}))

const {
  addGuildRole,
  guildMemberRoles,
  guildRoles,
  guildRoster,
  removeGuildRole,
} = await import('./discord.js')
const {
  desiredRoles,
  sweepDiscordRoles,
  syncUserRoles,
  syncUsersRoles,
} = await import('./discordRoles.js')

const roster = vi.mocked(guildRoster)
const oneMember = vi.mocked(guildMemberRoles)
const roles = vi.mocked(guildRoles)
const added = vi.mocked(addGuildRole)
const removed = vi.mocked(removeGuildRole)

const PREFIX = 'test-discord-roles-'
const email = (name: string) => `${PREFIX}${name}@ucf.edu`

/** Invented, and distinct from the `9…` block `discordOfficers.test.ts` uses
    for its own fixtures — both columns are unique and a clash is a red test. */
const snowflake = (n: number) => `70${String(n).padStart(16, '0')}`
const handle = (name: string) => `test_roles_${name}`

const NOW = new Date('2035-10-01T12:00:00')
const COVERED = new Date('2035-12-31T00:00:00')
const LAPSED = new Date('2035-09-01T00:00:00')

/** What the guild says, built from this suite's fixtures and nobody else's. */
const guild = (people: Record<string, string[]>, handles: Record<string, string> = {}) => ({
  status: 'ok' as const,
  roster: {
    byId: new Map(Object.entries(people)),
    idByHandle: new Map(Object.entries(handles)),
  },
})

const clearRows = async () => {
  await prisma.projectMember.deleteMany({
    where: { project: { slug: { startsWith: PREFIX } } },
  })
  await prisma.project.deleteMany({ where: { slug: { startsWith: PREFIX } } })
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
}

const makeUser = (
  name: string,
  extra: {
    discordId?: string | null
    discordUsername?: string | null
    duesPaidThrough?: Date | null
  } = {},
) =>
  prisma.user.create({
    data: {
      fullName: `Roles ${name}`,
      email: email(name),
      role: UserRole.MEMBER,
      ...extra,
    },
    select: { id: true },
  })

const makeProject = (name: string, discordRoleId: string | null = null) =>
  prisma.project.create({
    data: {
      slug: `${PREFIX}${name}`,
      title: `Roles ${name}`,
      termYear: 2035,
      termSeason: Season.FALL,
      discordRoleId,
    },
    select: { id: true },
  })

const seat = (
  projectId: string,
  userId: string,
  rank: ProjectMemberRank = ProjectMemberRank.MEMBER,
) => prisma.projectMember.create({ data: { projectId, userId, rank } })

/** Every role this run tried to add or remove, as `add:role` / `remove:role`. */
const writes = () => [
  ...added.mock.calls.map((call) => `add:${call[1]}`),
  ...removed.mock.calls.map((call) => `remove:${call[1]}`),
]

beforeEach(async () => {
  config.member = MEMBER_ROLE
  config.lead = LEAD_ROLE
  config.team = TEAM_ROLE
  config.dry = false

  roster.mockReset()
  oneMember.mockReset()
  roles.mockReset()
  oneMember.mockResolvedValue({ status: 'ok', roles: [] })
  added.mockReset()
  removed.mockReset()
  added.mockResolvedValue({ status: 'done' })
  removed.mockResolvedValue({ status: 'done' })
  // Every configured id is a real role unless a test says otherwise, so the
  // "not a role in this guild" warning stays out of the way.
  roles.mockResolvedValue({
    status: 'ok',
    roles: new Map(
      [MEMBER_ROLE, LEAD_ROLE, TEAM_ROLE, CREW_ROLE, OTHER_CREW, UNMANAGED].map(
        (id) => [id, `role ${id}`],
      ),
    ),
  })

  await clearRows()
})

afterAll(async () => {
  await clearRows()
})

describe('desiredRoles', () => {
  const person = (
    duesPaidThrough: Date | null,
    projects: { rank: ProjectMemberRank; discordRoleId: string | null }[],
  ) => ({
    id: 'x',
    fullName: 'X',
    discordId: null,
    discordUsername: null,
    duesPaidThrough,
    projects: projects.map(({ rank, discordRoleId }) => ({
      rank,
      project: { discordRoleId },
    })),
  })

  it('gives the member role for a date still running and not for one that has passed', () => {
    expect(desiredRoles(person(COVERED, []), NOW)).toEqual(
      new Set([MEMBER_ROLE]),
    )
    expect(desiredRoles(person(LAPSED, []), NOW)).toEqual(new Set())
    expect(desiredRoles(person(null, []), NOW)).toEqual(new Set())
  })

  it('keeps the lead role while they lead any project at all', () => {
    // The rule that a per-project delta would get wrong: stood down on one,
    // still leading another.
    const both = person(null, [
      { rank: ProjectMemberRank.MEMBER, discordRoleId: null },
      { rank: ProjectMemberRank.PROJECT_LEAD, discordRoleId: null },
    ])

    expect(desiredRoles(both, NOW)).toEqual(new Set([LEAD_ROLE]))
  })

  it('keeps a crew role held through two semesters of the same build', () => {
    // One role, two rows — which is what duplicating a project forward makes,
    // and why the column carries no unique index.
    const twice = person(null, [
      { rank: ProjectMemberRank.MEMBER, discordRoleId: CREW_ROLE },
      { rank: ProjectMemberRank.MEMBER, discordRoleId: CREW_ROLE },
    ])

    expect(desiredRoles(twice, NOW)).toEqual(new Set([CREW_ROLE]))
  })

  it('names every distinct crew role and both lead roles at once', () => {
    const busy = person(COVERED, [
      { rank: ProjectMemberRank.PROJECT_LEAD, discordRoleId: CREW_ROLE },
      { rank: ProjectMemberRank.TEAM_LEAD, discordRoleId: OTHER_CREW },
    ])

    expect(desiredRoles(busy, NOW)).toEqual(
      new Set([MEMBER_ROLE, LEAD_ROLE, TEAM_ROLE, CREW_ROLE, OTHER_CREW]),
    )
  })

  it('names nothing for a role that is not configured', () => {
    config.member = null

    expect(desiredRoles(person(COVERED, []), NOW)).toEqual(new Set())
  })
})

describe('sweepDiscordRoles', () => {
  it('adds the member role to somebody whose dues date is still running', async () => {
    const user = await makeUser('paid', {
      discordId: snowflake(1),
      duesPaidThrough: COVERED,
    })
    roster.mockResolvedValue(guild({ [snowflake(1)]: [] }))

    const report = await sweepDiscordRoles(NOW)

    expect(writes()).toEqual([`add:${MEMBER_ROLE}`])
    expect(added).toHaveBeenCalledWith(
      snowflake(1),
      MEMBER_ROLE,
      expect.stringContaining('RCCF website'),
    )
    expect(report).toMatchObject({ added: 1, removed: 0, people: 1 })
    expect(user.id).toBeTruthy()
  })

  it('takes the member role back off once the date has passed', async () => {
    await makeUser('lapsed', {
      discordId: snowflake(2),
      duesPaidThrough: LAPSED,
    })
    roster.mockResolvedValue(guild({ [snowflake(2)]: [MEMBER_ROLE] }))

    const report = await sweepDiscordRoles(NOW)

    expect(writes()).toEqual([`remove:${MEMBER_ROLE}`])
    expect(report).toMatchObject({ added: 0, removed: 1 })
  })

  it('never removes a role it does not own', async () => {
    // The safety of the whole removal loop. This person should hold nothing,
    // and carries a role belonging to somebody else's part of the guild.
    await makeUser('pronouns', { discordId: snowflake(3) })
    roster.mockResolvedValue(guild({ [snowflake(3)]: [UNMANAGED] }))

    const report = await sweepDiscordRoles(NOW)

    expect(writes()).toEqual([])
    expect(report).toMatchObject({ added: 0, removed: 0, people: 1 })
  })

  it('leaves anybody the site cannot match completely alone', async () => {
    await makeUser('offline', {
      discordId: snowflake(4),
      duesPaidThrough: COVERED,
    })
    // A guild full of people, none of them this fixture.
    roster.mockResolvedValue(
      guild({ '700000000000000999': [MEMBER_ROLE, UNMANAGED] }),
    )

    const report = await sweepDiscordRoles(NOW)

    expect(writes()).toEqual([])
    expect(report).toMatchObject({ people: 0 })
  })

  it('matches on the handle when the snowflake was never captured', async () => {
    await makeUser('handleonly', {
      discordUsername: handle('handleonly'),
      duesPaidThrough: COVERED,
    })
    roster.mockResolvedValue(
      guild({ [snowflake(5)]: [] }, { [handle('handleonly')]: snowflake(5) }),
    )

    await sweepDiscordRoles(NOW)

    expect(added).toHaveBeenCalledWith(
      snowflake(5),
      MEMBER_ROLE,
      expect.any(String),
    )
  })

  it('gives a project lead both the lead role and their crew role', async () => {
    const user = await makeUser('lead', { discordId: snowflake(6) })
    const project = await makeProject('rover', CREW_ROLE)
    await seat(project.id, user.id, ProjectMemberRank.PROJECT_LEAD)
    roster.mockResolvedValue(guild({ [snowflake(6)]: [] }))

    await sweepDiscordRoles(NOW)

    expect(writes().sort()).toEqual(
      [`add:${CREW_ROLE}`, `add:${LEAD_ROLE}`].sort(),
    )
  })

  it('leaves the crew role alone when one of two semesters is left behind', async () => {
    // Both rows carry the same role, and they are only on one of them now.
    const user = await makeUser('twoterms', { discordId: snowflake(7) })
    const spring = await makeProject('storm-spring', CREW_ROLE)
    await makeProject('storm-fall', CREW_ROLE)
    await seat(spring.id, user.id)
    roster.mockResolvedValue(guild({ [snowflake(7)]: [CREW_ROLE] }))

    await sweepDiscordRoles(NOW)

    expect(writes()).toEqual([])
  })

  it('writes nothing on a second pass', async () => {
    await makeUser('settled', {
      discordId: snowflake(8),
      duesPaidThrough: COVERED,
    })
    roster.mockResolvedValue(guild({ [snowflake(8)]: [] }))

    await sweepDiscordRoles(NOW)
    expect(writes()).toEqual([`add:${MEMBER_ROLE}`])

    // Second pass, with the guild now reflecting the first.
    added.mockClear()
    removed.mockClear()
    roster.mockResolvedValue(guild({ [snowflake(8)]: [MEMBER_ROLE] }))

    const report = await sweepDiscordRoles(NOW)

    expect(writes()).toEqual([])
    expect(report).toMatchObject({ added: 0, removed: 0 })
  })

  describe('refusing to run', () => {
    it('does nothing at all when no role is configured', async () => {
      config.member = null
      config.lead = null
      config.team = null
      await makeUser('nobody', { discordId: snowflake(9) })

      const report = await sweepDiscordRoles(NOW)

      expect(report.skipped).toBe('not-configured')
      expect(roster).not.toHaveBeenCalled()
      expect(writes()).toEqual([])
    })

    it('runs for a project role even with no club role configured', async () => {
      // The switch is per role, and a project carrying one is enough on its own.
      config.member = null
      config.lead = null
      config.team = null
      const user = await makeUser('crewonly', { discordId: snowflake(10) })
      const project = await makeProject('crew', CREW_ROLE)
      await seat(project.id, user.id)
      roster.mockResolvedValue(guild({ [snowflake(10)]: [] }))

      const report = await sweepDiscordRoles(NOW)

      expect(report.skipped).toBeUndefined()
      expect(writes()).toEqual([`add:${CREW_ROLE}`])
    })

    it('writes nothing when the guild could not be read', async () => {
      await makeUser('unreachable', {
        discordId: snowflake(11),
        duesPaidThrough: COVERED,
      })
      roster.mockResolvedValue({ status: 'unavailable', reason: '503' })

      const report = await sweepDiscordRoles(NOW)

      expect(report.skipped).toBe('discord-unavailable')
      expect(writes()).toEqual([])
    })

    it('holds a role back when it would come off too many people at once', async () => {
      // Seven holders, all of them losing it — a column read wrong, not
      // turnover. The floor of five is what stops this being three people.
      const holders: Record<string, string[]> = {}

      for (let n = 20; n < 27; n++) {
        await makeUser(`crowd${n}`, { discordId: snowflake(n) })
        holders[snowflake(n)] = [MEMBER_ROLE]
      }

      roster.mockResolvedValue(guild(holders))

      const report = await sweepDiscordRoles(NOW)

      expect(report.heldBack).toEqual([MEMBER_ROLE])
      expect(writes()).toEqual([])
    })

    it('lets ordinary turnover through', async () => {
      // One of seven loses it: well under a quarter, and under the floor.
      const holders: Record<string, string[]> = {}

      for (let n = 30; n < 37; n++) {
        await makeUser(`steady${n}`, {
          discordId: snowflake(n),
          // Everybody but the first is still covered.
          duesPaidThrough: n === 30 ? LAPSED : COVERED,
        })
        holders[snowflake(n)] = [MEMBER_ROLE]
      }

      roster.mockResolvedValue(guild(holders))

      const report = await sweepDiscordRoles(NOW)

      expect(report.heldBack).toEqual([])
      expect(writes()).toEqual([`remove:${MEMBER_ROLE}`])
    })
  })

  describe('the dry run', () => {
    it('works out the same changes and issues none of them', async () => {
      config.dry = true
      await makeUser('dry', {
        discordId: snowflake(40),
        duesPaidThrough: COVERED,
      })
      roster.mockResolvedValue(guild({ [snowflake(40)]: [UNMANAGED] }))

      const report = await sweepDiscordRoles(NOW)

      // Reported as though it had happened, so the log names the real diff…
      expect(report).toMatchObject({ added: 1, removed: 0 })
      // …and nothing reached Discord.
      expect(added).not.toHaveBeenCalled()
      expect(removed).not.toHaveBeenCalled()
    })

    it('stops at the write budget rather than working through a backlog', async () => {
      config.dry = true
      const holders: Record<string, string[]> = {}

      for (let n = 100; n < 160; n++) {
        await makeUser(`bulk${n}`, {
          discordId: snowflake(n),
          duesPaidThrough: COVERED,
        })
        holders[snowflake(n)] = []
      }

      roster.mockResolvedValue(guild(holders))

      const report = await sweepDiscordRoles(NOW)

      expect(report.budgetSpent).toBe(true)
      expect(report.added).toBe(50)
      expect(report.people).toBe(60)
    })
  })
})

describe('syncUserRoles', () => {
  it('changes one person and touches nobody else', async () => {
    const mine = await makeUser('one', {
      discordId: snowflake(50),
      duesPaidThrough: COVERED,
    })
    await makeUser('two', {
      discordId: snowflake(51),
      duesPaidThrough: COVERED,
    })
    // One member read, not a guild walk — the whole point of the one-person
    // path. Deleting a twenty-member project used to be twenty walks.
    oneMember.mockResolvedValue({ status: 'ok', roles: [] })

    await syncUserRoles(mine.id, 'dues paid', NOW)

    expect(roster).not.toHaveBeenCalled()
    expect(oneMember).toHaveBeenCalledExactlyOnceWith(snowflake(50))
    expect(added).toHaveBeenCalledTimes(1)
    expect(added).toHaveBeenCalledWith(
      snowflake(50),
      MEMBER_ROLE,
      'RCCF website: dues paid',
    )
  })

  it('does nothing for somebody with no Discord identity at all', async () => {
    const nobody = await makeUser('anonymous', { duesPaidThrough: COVERED })

    await syncUserRoles(nobody.id, 'dues paid', NOW)

    expect(oneMember).not.toHaveBeenCalled()
    expect(writes()).toEqual([])
  })

  it('does not apply the overshoot guard to one person losing everything', async () => {
    // The guard is about a role coming off the club, not about somebody
    // legitimately leaving. Applying it here would refuse a real departure.
    const user = await makeUser('departing', { discordId: snowflake(52) })
    oneMember.mockResolvedValue({
      status: 'ok',
      roles: [MEMBER_ROLE, LEAD_ROLE, TEAM_ROLE],
    })

    await syncUserRoles(user.id, 'left the club', NOW)

    expect(writes().sort()).toEqual(
      [
        `remove:${LEAD_ROLE}`,
        `remove:${MEMBER_ROLE}`,
        `remove:${TEAM_ROLE}`,
      ].sort(),
    )
  })
})

/**
 * A whole roster at once — a project or team deleted, or a project's role
 * changed. The reason this exists rather than a loop over `syncUserRoles` is
 * arithmetic: two calls per person, all fired together, is forty simultaneous
 * requests for a twenty-member project.
 */
describe('syncUsersRoles', () => {
  it('shares one guild walk across everybody named', async () => {
    const one = await makeUser('bulk-one', { discordId: snowflake(70) })
    const two = await makeUser('bulk-two', { discordId: snowflake(71) })
    // Some project has to claim the role for it to be one this sync owns —
    // nobody is seated on it, which is the state a just-deleted project leaves
    // its members in.
    await makeProject('bulk-crew', CREW_ROLE)
    roster.mockResolvedValue(
      guild({
        [snowflake(70)]: [CREW_ROLE],
        [snowflake(71)]: [CREW_ROLE],
      }),
    )

    await syncUsersRoles([one.id, two.id], 'the project was deleted', NOW)

    expect(roster).toHaveBeenCalledTimes(1)
    expect(oneMember).not.toHaveBeenCalled()
    expect(writes()).toEqual([`remove:${CREW_ROLE}`, `remove:${CREW_ROLE}`])
  })

  it('asks Discord nothing when none of them has an identity on file', async () => {
    const nobody = await makeUser('bulk-anonymous')

    await syncUsersRoles([nobody.id], 'the project was deleted', NOW)

    expect(roster).not.toHaveBeenCalled()
    expect(writes()).toEqual([])
  })

  it('asks Discord nothing for an empty list', async () => {
    // A project with no members is deleted more often than one might think.
    await syncUsersRoles([], 'the project was deleted', NOW)

    expect(roster).not.toHaveBeenCalled()
  })
})

describe('the isolation this suite depends on', () => {
  it('never writes for a real account, because the stubbed guild omits them', async () => {
    // The property every other test here leans on, asserted rather than
    // assumed. Real rows are in the database throughout; the sweep skips them
    // because the roster does not mention them.
    const real = await prisma.user.findMany({
      where: {
        email: { not: { startsWith: PREFIX } },
        OR: [{ discordId: { not: null } }, { discordUsername: { not: null } }],
      },
      select: { discordId: true },
    })

    await makeUser('bystander', {
      discordId: snowflake(60),
      duesPaidThrough: COVERED,
    })
    roster.mockResolvedValue(guild({ [snowflake(60)]: [] }))

    await sweepDiscordRoles(NOW)

    const touched = [...added.mock.calls, ...removed.mock.calls].map(
      (call) => call[0],
    )

    for (const person of real) {
      expect(touched).not.toContain(person.discordId)
    }
    expect(touched).toEqual([snowflake(60)])
  })
})
