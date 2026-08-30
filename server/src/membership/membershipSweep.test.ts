import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '../core/db.js'
import { UserRole } from '../generated/prisma/enums.js'
import { sweepLapsedMembers } from './membershipSweep.js'
import { clearCalendarCache } from './semester.js'

/**
 * Taking `MEMBER` back off somebody whose dues ran out.
 *
 * This is the one sweep on the site that changes what a person *is*, so what it
 * refuses to touch matters more than what it changes — and the database it runs
 * against has the club's real roster in it.
 *
 * **A prefix cannot isolate this suite, and for a while it looked like it
 * could.** Every fixture is keyed on `test-sweep-` and every assertion counts
 * only those rows, but the sweep itself is one roster-wide `updateMany` and the
 * clock is pinned to 2035 — under which *every* real member's dues have long
 * since run out. Against a seeded database of nineteen invented people that was
 * invisible. Against the club's imported roster the first `it` in this file
 * demoted thirty-two paid-up members to `GUEST`, silently, and passed.
 *
 * So the real rows are put back: `restoreRealMembers` records who was a
 * `MEMBER` before the suite touched anything and repairs them afterwards. It is
 * not a nicety. Nothing else in the file would have noticed.
 *
 * The clock is pinned to term time in 2035 for the same reason `authz.test.ts`
 * pins its own: whether anybody is lapsed is a property of the calendar, so on
 * the real clock this suite would pass all summer and fail in October.
 *
 * `fetch` answers with a synthetic feed rather than failing, and that detail is
 * the point of one of the tests below: the sweep stands down when the dates are
 * fallbacks, so a suite that stubbed a *failure* would only ever prove it
 * standing down.
 */

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

/** Answers for the terms above and 404s anything else, so a stray year is loud. */
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

const PREFIX = 'test-sweep-'
const email = (name: string) => `${PREFIX}${name}@ucf.edu`

/** October: fall is running and its free opening weeks are long over. */
const IN_TERM = new Date('2035-10-01T12:00:00')
/** Mid-summer, when the club charges nobody anything. */
const IN_SUMMER = new Date('2035-06-20T12:00:00')

const LAPSED = new Date('2035-01-15T00:00:00')
const COVERED = new Date('2035-12-31T23:59:59')

const clearRows = () =>
  prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })

/**
 * Everybody who is a `MEMBER` and is not this suite's business.
 *
 * Captured before each test and restored after it. Reading the ids rather than
 * counting them matters: what has to go back is exactly the set that was there,
 * and a sweep that demoted somebody who was already `GUEST` must not promote
 * them on the way out.
 */
let realMembers: string[] = []

const rememberRealMembers = async () => {
  const rows = await prisma.user.findMany({
    where: { role: UserRole.MEMBER, NOT: { email: { startsWith: PREFIX } } },
    select: { id: true },
  })

  realMembers = rows.map((row) => row.id)
}

const restoreRealMembers = async () => {
  if (realMembers.length === 0) return

  await prisma.user.updateMany({
    where: { id: { in: realMembers }, role: UserRole.GUEST },
    data: { role: UserRole.MEMBER },
  })
}

const roleOf = async (name: string) =>
  (
    await prisma.user.findUniqueOrThrow({
      where: { email: email(name) },
      select: { role: true },
    })
  ).role

beforeEach(async () => {
  clearCalendarCache()
  // Before the clock moves. `vi.setSystemTime` is what makes every real member
  // read as lapsed, so the snapshot has to be taken on the real one.
  await rememberRealMembers()
  vi.stubGlobal('fetch', calendar())
  vi.useFakeTimers()
  vi.setSystemTime(IN_TERM)

  await clearRows()

  await prisma.user.createMany({
    data: [
      // The case the sweep is for: paid once, lapsed.
      {
        fullName: 'Sweep Lapsed',
        email: email('lapsed'),
        role: UserRole.MEMBER,
        duesPaidThrough: LAPSED,
      },
      // Paid and still covered.
      {
        fullName: 'Sweep Covered',
        email: email('covered'),
        role: UserRole.MEMBER,
        duesPaidThrough: COVERED,
      },
      // A roster entry an officer typed. No payment has ever been recorded for
      // them, and the site must not demote what it did not promote.
      {
        fullName: 'Sweep Handmade',
        email: email('handmade'),
        role: UserRole.MEMBER,
        duesPaidThrough: null,
      },
      // Everybody whose role is not `MEMBER`, all lapsed. Their tools lock;
      // their standing does not move. Two of them now — `UserRole` used to
      // carry four more, and the sweep's rule is unchanged by their going.
      ...[UserRole.ADMIN, UserRole.OFFICER].map((role) => ({
        fullName: `Sweep ${role}`,
        email: email(role.toLowerCase()),
        role,
        duesPaidThrough: LAPSED,
      })),
    ],
  })
})

afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  clearCalendarCache()
  await restoreRealMembers()
})

afterAll(async () => {
  await clearRows()
  await prisma.$disconnect()
})

describe('sweepLapsedMembers', () => {
  it('moves a lapsed member back to GUEST', async () => {
    const report = await sweepLapsedMembers()

    expect(report.demoted).toBeGreaterThanOrEqual(1)
    expect(await roleOf('lapsed')).toBe(UserRole.GUEST)
  })

  it('leaves a member whose dues still cover them', async () => {
    await sweepLapsedMembers()

    expect(await roleOf('covered')).toBe(UserRole.MEMBER)
  })

  /**
   * The guard that keeps this from emptying the roster the first time it runs.
   * Most of the club's history is roster entries typed by an officer with no
   * payment on record, and the site demotes only what the site promoted.
   */
  it('never demotes a member the site never promoted', async () => {
    await sweepLapsedMembers()

    expect(await roleOf('handmade')).toBe(UserRole.MEMBER)
  })

  /**
   * `OFFICER` and `ADMIN` are conferred by a person for reasons that have
   * nothing to do with a payment. Stripping an officer of their seat because
   * they forgot to pay would be a far worse bug than the one this fixes — their
   * *tools* lock, in `authz.ts`, and their standing stays put.
   */
  it('never touches a role that is not MEMBER', async () => {
    await sweepLapsedMembers()

    for (const role of [UserRole.ADMIN, UserRole.OFFICER]) {
      expect(await roleOf(role.toLowerCase())).toBe(role)
    }
  })

  /** Runs on every instance, so a second pass has to match nothing. */
  it('is idempotent', async () => {
    const first = await sweepLapsedMembers()
    const second = await sweepLapsedMembers()

    expect(first.demoted).toBeGreaterThanOrEqual(1)
    expect(second.demoted).toBe(0)
  })

  /**
   * Most of the year there is nothing expired for anybody, and the sweep stops
   * on its first query rather than scanning the roster.
   */
  it('stands down when nothing is expired for anybody', async () => {
    vi.setSystemTime(IN_SUMMER)

    const report = await sweepLapsedMembers()

    expect(report).toEqual({ demoted: 0, skipped: 'nothing-is-expired' })
    expect(await roleOf('lapsed')).toBe(UserRole.MEMBER)
  })

  /**
   * Fallback dates are approximately right, which is fine for quoting a price
   * and not fine for changing what somebody is. This is the only test here that
   * takes the calendar away, and it has to take it away *and* clear the cache,
   * or the terms the other tests read are still sitting in it.
   */
  it('stands down when the term dates are guesses', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    clearCalendarCache()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('down', { status: 503 }))),
    )

    const report = await sweepLapsedMembers()

    expect(report).toEqual({ demoted: 0, skipped: 'calendar-unreadable' })
    expect(await roleOf('lapsed')).toBe(UserRole.MEMBER)
    expect(consoleWarn).toHaveBeenCalled()
    consoleWarn.mockRestore()
  })
})
