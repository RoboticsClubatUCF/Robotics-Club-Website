import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '../core/db.js'
import { UserRole } from '../generated/prisma/enums.js'

/**
 * Following the club's Discord Officer Alumni role.
 *
 * This suite writes to the database, and one of its two queries is roster-wide. Marking is safe
 * by construction — a candidate has to appear in the stubbed guild. Clearing is the dangerous
 * half: its candidate query is `where: { officerAlumnus: true }` across the whole table, so
 * anybody the stubbed roster fails to name gets the flag taken off.
 *
 * The isolation is therefore the stub, and `holders()` takes the club's real flag-holders in
 * every call for the same reason `discordOfficers.test.ts` passes the real board. There are none
 * today — the column was added with `default false` — but a suite that relied on that would break
 * silently the first time somebody ran the real sweep against the development database.
 *
 * The `afterEach` tripwire repairs before it reports: reporting alone would leave real accounts
 * wrong until somebody read the output.
 *
 * `membersWithRole` is mocked outright rather than only when unconfigured. The development `.env`
 * carries a live bot token, and one unmocked call would pull 1,845 real members into the decision
 * under test.
 */

const config = vi.hoisted(() => ({
  role: '679377897710157866' as string | null,
}))

vi.mock('./discord.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./discord.js')>()),
  // Getters, not values: both are module constants read through a live binding
  // at call time, which is what lets one test run configured and the next run
  // with nothing set. A `vi.mock` factory is hoisted above every import and
  // cannot read a `const` from this module, hence `vi.hoisted`.
  get officerAlumniRoleId() {
    return config.role
  },
  get alumniSyncConfigured() {
    return config.role !== null
  },
  membersWithRole: vi.fn(),
}))

const { membersWithRole } = await import('./discord.js')
const { syncOfficerAlumni } = await import('./discordAlumni.js')

const roster = vi.mocked(membersWithRole)

const PREFIX = 'test-discord-alumni-'
const email = (name: string) => `${PREFIX}${name}@ucf.edu`

/** Invented, and a different block from the `70…` and `8…`/`9…` ones the roles
    and officers suites use — both columns are unique and a clash is a red test. */
const snowflake = (n: number) => `72${String(n).padStart(16, '0')}`
const handle = (name: string) => `test_alumni_${name}`

type Person = { discordId: string | null; discordUsername: string | null }

/**
 * Everybody the club's real data says is an officer alumnus, so the stub can
 * hand them all back and this suite cannot clear any of them.
 *
 * Read fresh in each `beforeEach` rather than once, because suite order is not
 * something to depend on.
 */
const realAlumni = () =>
  prisma.user.findMany({
    where: {
      officerAlumnus: true,
      email: { not: { startsWith: PREFIX } },
      OR: [{ discordId: { not: null } }, { discordUsername: { not: null } }],
    },
    select: { id: true, discordId: true, discordUsername: true },
  })

let real: Awaited<ReturnType<typeof realAlumni>> = []

/**
 * A stand-in snowflake for a real row that has a handle and no `discordId`.
 *
 * Most of the club is in that state. Safe because nothing here writes a
 * snowflake anywhere — this sweep backfills nothing, unlike the officer one —
 * so a synthetic id can only ever be compared against.
 */
let standIn = 0
const standInId = () => `73${String((standIn += 1)).padStart(16, '0')}`

/** The answer `membersWithRole` gives. Pass the real alumni in every time. */
const holders = (...people: Person[]) => {
  const ids = new Set<string>()
  const byHandle = new Map<string, string>()

  for (const person of people) {
    const id = person.discordId ?? (person.discordUsername ? standInId() : null)
    if (id === null) continue
    ids.add(id)
    if (person.discordUsername) byHandle.set(person.discordUsername.toLowerCase(), id)
  }

  return { status: 'ok' as const, ids, byHandle }
}

const clearRows = () =>
  prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })

const makeUser = (
  name: string,
  extra: {
    discordId?: string | null
    discordUsername?: string | null
    officerAlumnus?: boolean
  } = {},
) =>
  prisma.user.create({
    data: {
      fullName: `Alumni ${name}`,
      email: email(name),
      role: UserRole.MEMBER,
      ...extra,
    },
    select: { id: true },
  })

const flagOf = async (name: string) =>
  (
    await prisma.user.findUniqueOrThrow({
      where: { email: email(name) },
      select: { officerAlumnus: true },
    })
  ).officerAlumnus

beforeEach(async () => {
  config.role = '679377897710157866'
  roster.mockReset()
  await clearRows()
  real = await realAlumni()
})

afterEach(async () => {
  // The tripwire. It repairs first and reports second — a test that forgets to
  // seed the stub with the club's real alumni would otherwise leave them
  // cleared until somebody read the output.
  const after = await prisma.user.findMany({
    where: { id: { in: real.map((person) => person.id) } },
    select: { id: true, officerAlumnus: true },
  })

  const lost = after.filter((person) => !person.officerAlumnus)

  if (lost.length > 0) {
    await prisma.user.updateMany({
      where: { id: { in: lost.map((person) => person.id) } },
      data: { officerAlumnus: true },
    })
  }

  // Marking is stub-bounded, but assert it anyway: it is one `updateMany` away
  // from being roster-wide if somebody ever drops the `OR` pre-filter.
  const strays = await prisma.user.count({
    where: { officerAlumnus: true, email: { not: { startsWith: PREFIX } } },
  })

  expect(
    lost,
    'a real officer alumnus lost the flag — the roster stub is not covering the club. It has been put back, but fix the test.',
  ).toEqual([])

  expect(
    strays,
    'this suite flagged somebody who is not its fixture — the roster stub named an account it does not control.',
  ).toBe(real.length)

  await clearRows()
})

afterAll(async () => {
  await clearRows()
  await prisma.$disconnect()
})

describe('syncOfficerAlumni', () => {
  it('marks somebody who holds the role', async () => {
    await makeUser('newalum', { discordId: snowflake(1) })
    roster.mockResolvedValue(
      holders(...real, { discordId: snowflake(1), discordUsername: null }),
    )

    const report = await syncOfficerAlumni()

    expect(report.marked).toBe(1)
    expect(await flagOf('newalum')).toBe(true)
  })

  it('matches on the handle when no snowflake is on file', async () => {
    await makeUser('byhandle', {
      discordId: null,
      discordUsername: handle('byhandle'),
    })
    roster.mockResolvedValue(
      holders(...real, { discordId: null, discordUsername: handle('byhandle') }),
    )

    await syncOfficerAlumni()

    expect(await flagOf('byhandle')).toBe(true)
  })

  /**
   * The other direction, and the one `holds` exists for. A row whose stored
   * `discordId` is stale but whose handle still matches must not be marked and
   * cleared on alternate sweeps for ever, which is what computing "holds the
   * role" differently for the two directions would produce.
   */
  it('clears somebody who no longer holds it', async () => {
    await makeUser('formeralum', {
      discordId: snowflake(2),
      officerAlumnus: true,
    })
    // Somebody else still holds it, so this is turnover rather than refusal 4.
    await makeUser('stillalum', { discordId: snowflake(3), officerAlumnus: true })
    roster.mockResolvedValue(
      holders(...real, { discordId: snowflake(3), discordUsername: null }),
    )

    const report = await syncOfficerAlumni()

    expect(report.cleared).toBe(1)
    expect(await flagOf('formeralum')).toBe(false)
    expect(await flagOf('stillalum')).toBe(true)
  })

  /** Rule 3 of the other two syncs, and it has to hold in both directions. */
  it('leaves somebody the site cannot match alone, either way', async () => {
    await makeUser('unmatchable', {
      discordId: null,
      discordUsername: null,
      officerAlumnus: true,
    })
    await makeUser('stranger', { discordId: snowflake(4) })
    roster.mockResolvedValue(holders(...real, { discordId: snowflake(9), discordUsername: null }))

    const report = await syncOfficerAlumni()

    expect(report).toMatchObject({ marked: 0, cleared: 0 })
    // Flagged, no Discord identity, not in the guild's answer — and untouched,
    // because the site has no way to ask about them.
    expect(await flagOf('unmatchable')).toBe(true)
    expect(await flagOf('stranger')).toBe(false)
  })

  it('does nothing at all when the role id is unset', async () => {
    config.role = null
    await makeUser('ignored', { discordId: snowflake(5) })

    const report = await syncOfficerAlumni()

    expect(report.skipped).toBe('not-configured')
    expect(roster).not.toHaveBeenCalled()
  })

  it('writes nothing when the guild cannot be read', async () => {
    await makeUser('safe', { discordId: snowflake(6), officerAlumnus: true })
    roster.mockResolvedValue({ status: 'unavailable', reason: 'network' })

    const report = await syncOfficerAlumni()

    expect(report.skipped).toBe('discord-unavailable')
    expect(await flagOf('safe')).toBe(true)
  })

  /**
   * The refusal that matters most, because Discord gives no error for it: a
   * typo'd snowflake returns the guild happily and simply appears in nobody's
   * `roles` array, so a wrong id and an empty list are byte-for-byte identical.
   */
  it('stands down when nobody in the guild holds the role', async () => {
    await makeUser('kept', { discordId: snowflake(7), officerAlumnus: true })
    roster.mockResolvedValue({
      status: 'ok',
      ids: new Set<string>(),
      byHandle: new Map<string, string>(),
    })

    const report = await syncOfficerAlumni()

    expect(report.skipped).toBe('no-role-holders')
    expect(await flagOf('kept')).toBe(true)
  })

  it('stands down rather than clear every alumnus at once', async () => {
    await makeUser('one', { discordId: snowflake(10), officerAlumnus: true })
    await makeUser('two', { discordId: snowflake(11), officerAlumnus: true })
    // The guild names somebody real enough to get past the empty-list refusal
    // and nobody this suite flagged, which is the renumbered-role shape.
    roster.mockResolvedValue(
      holders({ discordId: snowflake(12), discordUsername: null }),
    )

    const report = await syncOfficerAlumni()

    expect(report).toMatchObject({ marked: 0, cleared: 0, heldBack: true })
    expect(await flagOf('one')).toBe(true)
    expect(await flagOf('two')).toBe(true)
  })

  /**
   * The property the whole design leans on, asserted from the outside: a person
   * the stubbed guild does not mention is never written to, so this suite
   * cannot reach the club's real accounts however wrong it is elsewhere.
   */
  it('never touches an account the guild did not name', async () => {
    const others = await prisma.user.count({
      where: { email: { not: { startsWith: PREFIX } }, officerAlumnus: true },
    })

    await makeUser('bystander', { discordId: snowflake(20) })
    roster.mockResolvedValue(
      holders(...real, { discordId: snowflake(20), discordUsername: null }),
    )

    const report = await syncOfficerAlumni()

    expect(report.marked).toBe(1)
    expect(
      await prisma.user.count({
        where: { email: { not: { startsWith: PREFIX } }, officerAlumnus: true },
      }),
    ).toBe(others)
  })
})
