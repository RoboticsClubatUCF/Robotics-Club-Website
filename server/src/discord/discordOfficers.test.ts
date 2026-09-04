import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '../core/db.js'
import { UserRole } from '../generated/prisma/enums.js'
import { clearCalendarCache } from '../membership/semester.js'

/**
 * Following the club's Discord officer role.
 *
 * The most dangerous suite in the repository, and the reasons are worth stating before the code.
 * This sweep's demotion query is `where: { role: OFFICER }` — roster-wide by nature — and it runs
 * against the development database, which holds the club's real board. Unlike the dues sweep
 * there's no clock to pin: the candidate query never consults the calendar.
 *
 * The isolation is the stub. Almost every test seeds the stubbed guild roster with the club's
 * actual officers as well as its own fixtures, so the set of people the sweep can stand down is
 * exactly the set this suite created. A flat empty roster here doesn't leak a snowflake, it
 * demotes the treasurer.
 *
 * The one test that can't do that is the no-overlap guard, which by definition needs a roster
 * containing none of the sitting officers. Its safety is the guard under test, so the `afterEach`
 * both repairs and reports: a real officer who moved is put back and the test goes red.
 */

vi.mock('./discord.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./discord.js')>()),
  // Mocked outright rather than only when unconfigured. The development `.env` carries a live bot
  // token for the club's actual guild, and one unmocked call would pull the real officer roster
  // into the decision under test. The role id is a literal because a `vi.mock` factory is hoisted
  // above every import.
  officerRoleId: '267371948953042945',
  officerSyncConfigured: true,
  membersWithRole: vi.fn(),
}))

const { membersWithRole } = await import('./discord.js')
const { syncDiscordOfficers } = await import('./discordOfficers.js')

const roster = vi.mocked(membersWithRole)

/** A term as UCF publishes one, cut to the two events that matter. */
const feed = (classesBegin: string, housingCloses: string, session = '1') => ({
  terms: [
    {
      events: [
        { summary: 'Classes Begin', dtstart: classesBegin, eventSession: session },
        {
          summary: 'On-Campus Housing Closes',
          dtstart: housingCloses,
          eventSession: session,
        },
      ],
    },
  ],
})

const TERMS: Record<string, unknown> = {
  '2035/spring': feed('2035-01-08T08:00:00', '2035-05-04T09:00:00'),
  '2035/summer': feed('2035-05-14T08:00:00', '2035-08-03T09:00:00', 'c'),
  '2035/fall': feed('2035-08-20T08:00:00', '2035-12-12T09:00:00'),
  '2036/spring': feed('2036-01-07T08:00:00', '2036-05-02T09:00:00'),
}

/**
 * A *working* feed, not a failing one, for the reason `membershipSweep.test.ts`
 * gives: on fallback dates `standingRole` short-circuits to `MEMBER` and half
 * the assertions below become vacuous.
 */
const calendar = () =>
  vi.fn((input: string | URL | Request) => {
    const url = input.toString()
    const key = Object.keys(TERMS).find((term) => url.endsWith(term))

    return Promise.resolve(
      key
        ? new Response(JSON.stringify(TERMS[key]), { status: 200 })
        : new Response('no such term', { status: 404 }),
    )
  })

const PREFIX = 'test-officer-sync-'
const email = (name: string) => `${PREFIX}${name}@ucf.edu`

/**
 * Invented snowflakes and handles. `discordId` and `discordUsername` are both
 * unique, so a collision with a real member is a create that throws — a red
 * test, which is the right outcome.
 */
const snowflake = (n: number) => `9${String(n).padStart(17, '0')}`
const handle = (name: string) => `test_sync_${name}`

/** October: fall is running and its free opening weeks are long over. */
const IN_TERM = new Date('2035-10-01T12:00:00')
const COVERED = new Date('2035-12-31T23:59:59')

/**
 * Terms before people, and the order isn't tidiness.
 *
 * `OfficerTerm.userId` is `SetNull` — a term outlives the account on purpose, because the archive
 * has to keep somebody who left — so deleting a fixture first leaves its term behind with
 * `user_id` null and its `full_name` intact. An open orphan like that sits on the public board
 * under a fixture's name, which is how this suite once left two hundred invented officers on the
 * front page.
 */
const clearRows = async () => {
  await prisma.officerTerm.deleteMany({
    where: { user: { email: { startsWith: PREFIX } } },
  })
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
}

const rowOf = (name: string) =>
  prisma.user.findUniqueOrThrow({ where: { email: email(name) } })

const roleOf = async (name: string) => (await rowOf(name)).role

/**
 * Everyone on the club's real board, so the stub can hand them all back and this suite can't
 * stand any of them down.
 *
 * Read fresh in each `beforeEach` rather than once: other suites create and delete officers of
 * their own, and suite order isn't something to depend on.
 */
const realBoard = () =>
  prisma.user.findMany({
    where: {
      role: { in: [UserRole.ADMIN, UserRole.OFFICER] },
      email: { not: { startsWith: PREFIX } },
    },
    select: { id: true, role: true, discordId: true, discordUsername: true },
  })

type Person = { discordId: string | null; discordUsername: string | null }

/**
 * A stand-in snowflake for a real officer who has a handle and no `discordId`.
 *
 * Most of the club's board is in that state — the id has only been captured since signup started
 * asking Discord for it — and the first version of this helper dropped those rows from the roster
 * entirely, which stood a real officer down.
 *
 * Safe because a synthetic id can never be written anywhere: backfill only happens for rows being
 * promoted, and everybody this is used for is already an `OFFICER` or `ADMIN`. This is filling a
 * gap in our copy of the answer, not inventing one in the answer.
 */
let standIn = 0
const standInId = () => `8${String((standIn += 1)).padStart(17, '0')}`

/** The answer `membersWithRole` gives. Pass the real board in every time. */
function holders(...people: Person[]) {
  const ids = new Set<string>()
  const byHandle = new Map<string, string>()

  for (const person of people) {
    const id = person.discordId ?? (person.discordUsername ? standInId() : null)
    if (id) ids.add(id)
    if (person.discordUsername && id) {
      byHandle.set(person.discordUsername.toLowerCase(), id)
    }
  }

  return { status: 'ok' as const, ids, byHandle }
}

let board: Awaited<ReturnType<typeof realBoard>> = []

/**
 * Every officer term that existed before the test, so the ones this suite causes can be told
 * apart from the club's own.
 *
 * The role tripwire below isn't enough on its own, and one imported row proved it. Promotion
 * writes a term as well as a role, and an `ADMIN` who holds the Discord role gets the term while
 * their role correctly doesn't move — so a stubbed roster that happens to name a real admin's
 * handle opens a term on them, a later test closes it, and the tripwire sees nothing because no
 * role changed. What's left is a closed term on the public archive, dated 2035.
 */
let termsBefore = new Set<string>()

/**
 * The fixtures the guild says are officers.
 *
 * `handle-only` is in here with an id the guild knows and the database doesn't — that gap is the
 * backfill case, so it must be a real id in the roster rather than a placeholder.
 */
const HOLDING: Person[] = [
  { discordId: snowflake(1), discordUsername: handle('riser') },
  { discordId: snowflake(2), discordUsername: handle('guest') },
  { discordId: snowflake(5), discordUsername: handle('adminholder') },
  { discordId: snowflake(8), discordUsername: handle('handleonly') },
  { discordId: snowflake(7), discordUsername: handle('staying') },
]

beforeEach(async () => {
  clearCalendarCache()
  vi.stubGlobal('fetch', calendar())
  roster.mockReset()

  await clearRows()

  await prisma.user.createMany({
    data: [
      // Holds the role, and is a plain member today.
      {
        fullName: 'Sync Riser',
        email: email('riser'),
        role: UserRole.MEMBER,
        discordId: snowflake(1),
        discordUsername: handle('riser'),
        joinedAt: new Date('2035-08-01T00:00:00'),
      },
      // Holds the role, has never joined, and has no `joinedAt` to print.
      {
        fullName: 'Sync Guest',
        email: email('guest'),
        role: UserRole.GUEST,
        discordId: snowflake(2),
        discordUsername: handle('guest'),
      },
      // Sits on the board, does not hold the role, and is paid up.
      {
        fullName: 'Sync Leaving Paid',
        email: email('leaving-paid'),
        role: UserRole.OFFICER,
        discordId: snowflake(3),
        discordUsername: handle('leavingpaid'),
        duesPaidThrough: COVERED,
      },
      // Sits on the board, does not hold the role, and has never paid.
      {
        fullName: 'Sync Leaving Unpaid',
        email: email('leaving-unpaid'),
        role: UserRole.OFFICER,
        discordId: snowflake(4),
        discordUsername: handle('leavingunpaid'),
        duesPaidThrough: null,
      },
      // Sits on the board with no way to look them up in the guild.
      {
        fullName: 'Sync Stranger',
        email: email('stranger'),
        role: UserRole.OFFICER,
        duesPaidThrough: COVERED,
      },
      // Holds the role and is an admin. Must not move, in either direction.
      {
        fullName: 'Sync Admin Holder',
        email: email('admin-holder'),
        role: UserRole.ADMIN,
        discordId: snowflake(5),
        discordUsername: handle('adminholder'),
      },
      // An admin who does *not* hold it. Must not move either.
      {
        fullName: 'Sync Admin Outsider',
        email: email('admin-outsider'),
        role: UserRole.ADMIN,
        discordId: snowflake(6),
        discordUsername: handle('adminoutsider'),
      },
      // Matched by handle alone: no `discordId` on file, so the roster's id for
      // that handle is the one the sweep has to write back.
      {
        fullName: 'Sync Handle Only',
        email: email('handle-only'),
        role: UserRole.MEMBER,
        discordUsername: handle('handleonly'),
        joinedAt: new Date('2035-08-01T00:00:00'),
      },
      // Sits on the board and keeps the role, so the no-overlap guard does not
      // fire on the ordinary tests.
      {
        fullName: 'Sync Staying',
        email: email('staying'),
        role: UserRole.OFFICER,
        discordId: snowflake(7),
        discordUsername: handle('staying'),
        duesPaidThrough: COVERED,
      },
    ],
  })

  board = await realBoard()
  termsBefore = new Set(
    (await prisma.officerTerm.findMany({ select: { id: true } })).map((term) => term.id),
  )
})

afterEach(async () => {
  vi.unstubAllGlobals()
  clearCalendarCache()

  // The tripwire, and it repairs before it reports. A test that forgets to seed
  // the stub with the real board would otherwise leave the club's actual
  // officers demoted until somebody read the output.
  const after = await prisma.user.findMany({
    where: { id: { in: board.map((person) => person.id) } },
    select: { id: true, role: true },
  })

  const moved = after.filter(
    (person) =>
      person.role !== board.find((was) => was.id === person.id)?.role,
  )

  for (const person of moved) {
    const was = board.find((original) => original.id === person.id)
    if (was) {
      await prisma.user.update({ where: { id: was.id }, data: { role: was.role } })
    }
  }

  // The same shape for terms: repair first, then report.
  //
  // Every real officer is deliberately in the stubbed roster — that's what stops the sweep
  // standing them down — so the sync sees them holding the role and opens a term, which is the
  // sweep working correctly on a fixture it was handed. Those are cleaned up without complaint. A
  // term on anybody else is the roster stub having named an account this suite doesn't control.
  const onTheBoard = new Set(board.map((person) => person.id))
  const strayTerms = await prisma.officerTerm.findMany({
    where: {
      id: { notIn: [...termsBefore] },
      OR: [{ user: null }, { user: { email: { not: { startsWith: PREFIX } } } }],
    },
    select: { id: true, fullName: true, userId: true },
  })

  if (strayTerms.length > 0) {
    await prisma.officerTerm.deleteMany({
      where: { id: { in: strayTerms.map((term) => term.id) } },
    })
  }

  const unexpected = strayTerms.filter(
    (term) => term.userId === null || !onTheBoard.has(term.userId),
  )

  expect(
    moved,
    'a real ADMIN or OFFICER changed role — the roster stub is not covering the club board. Their role has been put back, but fix the test.',
  ).toEqual([])

  expect(
    unexpected.map((term) => term.fullName),
    'this suite opened an officer term on somebody who is neither its fixture nor on the club board — the roster stub named an account it does not control. The term has been deleted, but fix the test.',
  ).toEqual([])
})

afterAll(async () => {
  await clearRows()
  await prisma.$disconnect()
})

describe('syncDiscordOfficers', () => {
  it('promotes a member who holds the role', async () => {
    roster.mockResolvedValue(holders(...board, ...HOLDING))

    const report = await syncDiscordOfficers(IN_TERM)

    expect(report.skipped).toBeUndefined()
    expect(await roleOf('riser')).toBe(UserRole.OFFICER)
  })

  /**
   * A guest is promoted the whole way and gets the `joinedAt` a blank public
   * profile would otherwise print — the same rule `membershipUpdateFor` follows
   * when a payment promotes somebody.
   */
  it('promotes a guest and stamps joinedAt', async () => {
    roster.mockResolvedValue(holders(...board, ...HOLDING))

    await syncDiscordOfficers(IN_TERM)

    const guest = await rowOf('guest')
    expect(guest.role).toBe(UserRole.OFFICER)
    expect(guest.joinedAt).toEqual(IN_TERM)
  })

  /**
   * The rule with no exception. `ADMIN` is written by a person in Prisma Studio
   * and by nothing in this codebase, in either direction — and it is excluded
   * in the `where` of both queries rather than by a check that could be wrong.
   */
  it('never moves an admin, with or without the role', async () => {
    roster.mockResolvedValue(holders(...board, ...HOLDING))

    await syncDiscordOfficers(IN_TERM)

    expect(await roleOf('admin-holder')).toBe(UserRole.ADMIN)
    expect(await roleOf('admin-outsider')).toBe(UserRole.ADMIN)
  })

  it('stands a paid ex-officer down to MEMBER', async () => {
    roster.mockResolvedValue(holders(...board, ...HOLDING))

    const report = await syncDiscordOfficers(IN_TERM)

    expect(report.demoted).toBeGreaterThanOrEqual(1)
    expect(await roleOf('leaving-paid')).toBe(UserRole.MEMBER)
  })

  /**
   * The case that argues against a fixed demotion target. An ex-officer with no `duesPaidThrough`
   * left at `MEMBER` is unreachable by every other writer — `sweepLapsedMembers` only touches rows
   * that have a date — so they'd sit on the public roster for ever with no path off it.
   */
  it('stands an unpaid ex-officer down to GUEST', async () => {
    roster.mockResolvedValue(holders(...board, ...HOLDING))

    await syncDiscordOfficers(IN_TERM)

    expect(await roleOf('leaving-unpaid')).toBe(UserRole.GUEST)
  })

  /**
   * The analogue of the dues sweep's `duesPaidThrough: { not: null }`: an
   * officer the site cannot look up in the guild was appointed outside this
   * loop, and this loop does not get to undo it.
   */
  it('leaves an officer with no Discord identity alone', async () => {
    roster.mockResolvedValue(holders(...board, ...HOLDING))

    await syncDiscordOfficers(IN_TERM)

    expect(await roleOf('stranger')).toBe(UserRole.OFFICER)
  })

  it('promotes somebody matched by handle and backfills their id', async () => {
    roster.mockResolvedValue(holders(...board, ...HOLDING))

    await syncDiscordOfficers(IN_TERM)

    const row = await rowOf('handle-only')
    expect(row.role).toBe(UserRole.OFFICER)
    expect(row.discordId).toBe(snowflake(8))
  })

  it('does nothing on a second pass', async () => {
    roster.mockResolvedValue(holders(...board, ...HOLDING))

    await syncDiscordOfficers(IN_TERM)
    const again = await syncDiscordOfficers(IN_TERM)

    // Terms as well as roles: a second pass finds every one of them already
    // open, which is what `openTerm`'s check-then-act is for.
    expect(again).toEqual({ promoted: 0, demoted: 0, opened: 0, closed: 0 })
  })

  /**
   * Discord having a bad minute must not read as the board resigning. The
   * analogue of the dues sweep standing down on fallback calendar dates, and
   * stronger: bad dates are approximate, an unread guild is empty.
   */
  it('writes nothing when the guild cannot be read', async () => {
    roster.mockResolvedValue({ status: 'unavailable', reason: '503' })

    const report = await syncDiscordOfficers(IN_TERM)

    expect(report).toEqual({
      promoted: 0,
      demoted: 0,
      opened: 0,
      closed: 0,
      skipped: 'discord-unavailable',
    })
    expect(await roleOf('leaving-paid')).toBe(UserRole.OFFICER)
    expect(await roleOf('riser')).toBe(UserRole.MEMBER)
  })

  /**
   * The one Discord gives no error for. A role id that does not exist comes
   * back as a guild in which nobody carries it — byte-for-byte identical to a
   * deleted role, and to a board that genuinely emptied.
   */
  it('writes nothing when nobody holds the role', async () => {
    roster.mockResolvedValue(holders())

    const report = await syncDiscordOfficers(IN_TERM)

    expect(report.skipped).toBe('no-role-holders')
    expect(await roleOf('leaving-paid')).toBe(UserRole.OFFICER)
  })

  /**
   * Half the board rotating is ordinary and passes straight through. All of it disappearing
   * between two sweeps is a configuration problem, not a resignation.
   *
   * The one test that can't seed the real board into the roster, because a roster containing them
   * is the overlap it's checking for. Its safety is the guard under test plus the repairing
   * tripwire in `afterEach`.
   */
  it('writes nothing when no sitting officer holds the role', async () => {
    roster.mockResolvedValue(
      holders({ discordId: snowflake(1), discordUsername: handle('riser') }),
    )

    const report = await syncDiscordOfficers(IN_TERM)

    expect(report.skipped).toBe('no-overlap')
    expect(await roleOf('riser')).toBe(UserRole.MEMBER)
    expect(await roleOf('leaving-paid')).toBe(UserRole.OFFICER)
  })
})
