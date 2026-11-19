import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.js'
import { prisma } from '../../core/db.js'
import { env } from '../../core/env.js'
import { Season, UserRole } from '../../generated/prisma/enums.js'
import { clearCalendarCache, getTerm } from '../../membership/semester.js'
import { createSession } from '../../auth/session.js'

/**
 * The two desks added with officer tenure: who sits in which seat, and when the club says a
 * semester runs.
 *
 * Both write things the rest of the site reads at request time, so what these assert is mostly
 * the refusals: one person per seat, a term that ends before it starts, an override that must not
 * read as a guess.
 */

// Nothing here should reach the club's guild. These routes don't push roles themselves, but they
// share a router with ones that do, and the dev `.env` carries a live bot token against the real
// server. `testing.md`'s rule is that anything that can reach `pushRoles` mocks this module.
vi.mock('../../discord/discord.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../discord/discord.js')>()),
  officerRoleId: null,
  memberRoleId: null,
  projectLeadRoleId: null,
  teamLeadRoleId: null,
  printCrewRoleId: null,
  addGuildRole: vi.fn(() => Promise.resolve({ status: 'done' as const })),
  removeGuildRole: vi.fn(() => Promise.resolve({ status: 'done' as const })),
  guildRoster: vi.fn(() => Promise.resolve({ status: 'unchecked' as const })),
  guildRoles: vi.fn(() => Promise.resolve({ status: 'unchecked' as const })),
}))

const PREFIX = 'test-board-'
const email = (name: string) => `${PREFIX}${name}@ucf.edu`

/** Far enough out that no real row shares the year, the way the sweep suites
    pin theirs to 2035 — an override is keyed on `(year, season)` and the table
    is global. */
const YEAR = 2087

/** Paid through, because every officer route ends in `requireCurrentDues` and a
    lapsed officer is refused for a reason that has nothing to do with seats. */
const PAID_THROUGH = new Date(2099, 11, 31)
/**
 * The other gate, and it sits in front of the dues one. Every fixture that has
 * to reach anything needs both — a missing survey is a 403 that looks exactly
 * like a missing payment, and it is not what these tests are about.
 */
const SURVEYED = new Date('2035-09-01T00:00:00')

const clearWindows = () =>
  prisma.rateLimit.deleteMany({ where: { key: { startsWith: 'officer:' } } })

const clearRows = async () => {
  await prisma.officerTerm.deleteMany({
    where: { user: { email: { startsWith: PREFIX } } },
  })
  await prisma.termOverride.deleteMany({ where: { year: YEAR } })
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
}

async function cookieFor(userId: string): Promise<string> {
  const { token } = await createSession(userId)
  return `${env.SESSION_COOKIE_NAME}=${token}`
}

const send = (
  method: string,
  path: string,
  cookie: string,
  body?: unknown,
) =>
  app.request(path, {
    method,
    headers: {
      cookie,
      origin: env.SITE_URL,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

let officerCookie = ''
let officerId = ''
let advisorId = ''
let adminId = ''
let outgoingId = ''
let incomingId = ''

/**
 * The seats this suite borrows, and the people it borrows them from.
 *
 * The development database has a full board in it, so every one of these cases would otherwise
 * 409 against somebody genuinely sitting there. That conflict is the feature working.
 *
 * So the suite parks whoever holds a seat it needs: their term is left open and only its
 * `position` is cleared, so nobody is stood down and nothing lands on the public archive. It's
 * handed back in `afterEach`.
 */
let parked: { id: string; position: string }[] = []

const parkSeats = async () => {
  // Every seated open term, with no attempt to exclude this suite's own: they've already been
  // deleted by `clearRows`. An earlier version tried `email: { not: { startsWith: PREFIX } }` and
  // silently parked nothing, because the seeded officers have no email at all and `NOT LIKE`
  // against NULL is NULL rather than true.
  const held = await prisma.officerTerm.findMany({
    where: { endedAt: null, position: { not: null } },
    select: { id: true, position: true },
  })

  parked = held.flatMap((term) =>
    term.position ? [{ id: term.id, position: term.position }] : [],
  )

  await prisma.officerTerm.updateMany({
    where: { id: { in: parked.map((term) => term.id) } },
    data: { position: null },
  })
}

const unparkSeats = async () => {
  for (const term of parked) {
    await prisma.officerTerm.update({
      where: { id: term.id },
      // Cast: `position` came out of this column a moment ago.
      data: { position: term.position as never },
    })
  }
  parked = []
}

beforeEach(async () => {
  await clearWindows()
  await clearRows()
  await parkSeats()
  clearCalendarCache()

  const [officer, advisor, admin, outgoing, incoming] = await Promise.all([
    prisma.user.create({
      data: {
        fullName: 'Board Officer',
        email: email('officer'),
        role: UserRole.OFFICER,
        duesPaidThrough: PAID_THROUGH,
        surveyCompletedAt: SURVEYED,
      },
    }),
    prisma.user.create({
      data: {
        fullName: 'Board Advisor',
        email: email('advisor'),
        // A plain MEMBER on purpose: the advisor holds a seat without the
        // permission level, which is the case the seat/role split exists for.
        role: UserRole.MEMBER,
        duesPaidThrough: PAID_THROUGH,
        surveyCompletedAt: SURVEYED,
      },
    }),
    prisma.user.create({
      data: {
        fullName: 'Board Admin',
        email: email('admin'),
        role: UserRole.ADMIN,
      },
    }),
    prisma.user.create({
      data: {
        fullName: 'Board Outgoing',
        email: email('outgoing'),
        role: UserRole.MEMBER,
        duesPaidThrough: PAID_THROUGH,
      },
    }),
    prisma.user.create({
      data: {
        fullName: 'Board Incoming',
        email: email('incoming'),
        role: UserRole.MEMBER,
        duesPaidThrough: PAID_THROUGH,
        discordUsername: 'test_board_incoming',
      },
    }),
  ])

  officerId = officer.id
  advisorId = advisor.id
  adminId = admin.id
  outgoingId = outgoing.id
  incomingId = incoming.id
  officerCookie = await cookieFor(officer.id)
})

afterEach(async () => {
  await unparkSeats()
})

afterAll(async () => {
  await clearWindows()
  await clearRows()
  await prisma.$disconnect()
})

const seat = (cookie: string, userId: string, position: string | null) =>
  send('PATCH', '/api/officer/terms/seat', cookie, { userId, position })

const openTermOf = (userId: string) =>
  prisma.officerTerm.findFirst({
    where: { userId, endedAt: null },
    select: { position: true, endedAt: true },
  })

describe('the seat desk', () => {
  it('puts somebody in a seat, opening a term if they had none', async () => {
    const response = await seat(officerCookie, officerId, 'TREASURER')

    expect(response.status).toBe(200)
    expect(await openTermOf(officerId)).toMatchObject({ position: 'TREASURER' })
  })

  /**
   * The faculty advisor sits on the board as a plain `MEMBER`. It's the one seat
   * that doesn't bring the officer desks.
   */
  it('seats somebody who is not an officer by role', async () => {
    const response = await seat(officerCookie, advisorId, 'FACULTY_ADVISOR')

    expect(response.status).toBe(200)
    expect(await openTermOf(advisorId)).toMatchObject({
      position: 'FACULTY_ADVISOR',
    })
    // And their role is untouched by it.
    const advisor = await prisma.user.findUnique({
      where: { id: advisorId },
      select: { role: true },
    })
    expect(advisor?.role).toBe(UserRole.MEMBER)
  })

  /**
   * **An officer can also be an admin, and the board has to be able to say so.**
   * `UserRole` has one slot per person with `ADMIN` above `OFFICER`, so it never
   * could; a term can, and this is that.
   */
  it('seats an admin without touching their role', async () => {
    const response = await seat(officerCookie, adminId, 'PRESIDENT')

    expect(response.status).toBe(200)
    expect(await openTermOf(adminId)).toMatchObject({ position: 'PRESIDENT' })

    const admin = await prisma.user.findUnique({
      where: { id: adminId },
      select: { role: true },
    })
    expect(admin?.role).toBe(UserRole.ADMIN)
  })

  /**
   * One person per seat, and it is the route that enforces it — a partial
   * unique index over open terms is not something Prisma can express. The
   * refusal names the incumbent, because the next step is standing that
   * particular person down.
   */
  it('refuses a seat somebody else holds, and says who', async () => {
    await seat(officerCookie, officerId, 'SECRETARY')

    const response = await seat(officerCookie, advisorId, 'SECRETARY')

    expect(response.status).toBe(409)
    expect(((await response.json()) as { error: string }).error).toContain(
      'Board Officer',
    )
    // And nothing moved.
    expect(await openTermOf(advisorId)).toBeNull()
  })

  /** Re-seating the sitting holder is a move, not a conflict with themselves. */
  it('lets somebody keep the seat they already hold', async () => {
    await seat(officerCookie, officerId, 'MARKETING')

    expect((await seat(officerCookie, officerId, 'MARKETING')).status).toBe(200)
    // And one term, not two.
    const terms = await prisma.officerTerm.count({
      where: { userId: officerId, endedAt: null },
    })
    expect(terms).toBe(1)
  })

  it('moves somebody between seats without opening a second term', async () => {
    await seat(officerCookie, officerId, 'OUTREACH')
    await seat(officerCookie, officerId, 'LAB_MANAGER')

    expect(await openTermOf(officerId)).toMatchObject({ position: 'LAB_MANAGER' })
    expect(
      await prisma.officerTerm.count({ where: { userId: officerId, endedAt: null } }),
    ).toBe(1)
  })

  /** Clearing the seat leaves them on the board. They are still an officer,
      just not in a named chair — standing down is a different button. */
  it('clears a seat without ending the term', async () => {
    await seat(officerCookie, officerId, 'VICE_PRESIDENT')
    await seat(officerCookie, officerId, null)

    expect(await openTermOf(officerId)).toMatchObject({
      position: null,
      endedAt: null,
    })
  })

  /** Standing down closes the term, which is exactly what puts somebody on the
      public archive rather than removing them from the site. */
  it('stands somebody down onto the archive', async () => {
    await seat(officerCookie, officerId, 'PRESIDENT')

    const response = await send(
      'DELETE',
      `/api/officer/terms/${officerId}`,
      officerCookie,
    )

    expect(response.status).toBe(200)
    expect(await openTermOf(officerId)).toBeNull()

    const closed = await prisma.officerTerm.findFirst({
      where: { userId: officerId },
      select: { endedAt: true, endedReason: true, position: true },
    })
    // The seat is kept on the closed row: it is the record of what they held.
    expect(closed?.position).toBe('PRESIDENT')
    expect(closed?.endedAt).not.toBeNull()
    expect(closed?.endedReason).toContain('Board Officer')
  })

  it('404s standing down somebody who is not on the board', async () => {
    const response = await send(
      'DELETE',
      `/api/officer/terms/${advisorId}`,
      officerCookie,
    )

    expect(response.status).toBe(404)
  })

  it('keeps the whole desk to officers', async () => {
    const memberCookie = await cookieFor(advisorId)

    expect((await seat(memberCookie, advisorId, 'SECRETARY')).status).toBe(403)
    expect(
      (await app.request('/api/officer/terms', { headers: { cookie: memberCookie } }))
        .status,
    ).toBe(403)
  })
})

describe('the semester desk', () => {
  const override = (season: Season, body: unknown) =>
    send('PUT', `/api/officer/semesters/${String(YEAR)}/${season}`, officerCookie, body)

  it('lists all three terms of a year with the source that dated them', async () => {
    const response = await app.request(
      `/api/officer/semesters/${String(YEAR)}`,
      { headers: { cookie: officerCookie } },
    )

    expect(response.status).toBe(200)
    const terms = (await response.json()) as { season: string; source: string }[]

    expect(terms.map((term) => term.season)).toEqual(['SPRING', 'SUMMER', 'FALL'])
    // 2087 is not in anybody's published calendar, so these are the fixed dates.
    for (const term of terms) expect(term.source).toBe('fallback')
  })

  /**
   * The whole point of the desk: the club's own answer wins over the feed and
   * over the fallbacks, and `getTerm` is what everything else on the site asks.
   */
  it('takes precedence over the calendar and the fallbacks', async () => {
    // Local midnight, because that is what `startOfDay`/`endOfDay` in
    // `semester.ts` normalise every term to — the feed's dates included. A
    // fixture built in UTC would land on the previous evening here and the
    // assertion would be about the test's timezone rather than the override.
    const startsAt = new Date(YEAR, 0, 5)
    const endsAt = new Date(YEAR, 4, 1)

    expect((await override(Season.SPRING, { startsAt, endsAt })).status).toBe(200)

    const term = await getTerm(YEAR, Season.SPRING)

    expect(term.startsAt.getDate()).toBe(5)
    expect(term.endsAt.getMonth()).toBe(4)
    expect(term.overridden).toBe(true)
  })

  /**
   * An override must not read as a guess. `membershipSweep` and `standingRole` both stand down on
   * `fromCalendar: false`, on the grounds that guessed dates must never take somebody's membership
   * away — and a date an officer typed is the opposite of a guess. Getting this backwards would
   * quietly stop the dues sweep for any term the club had corrected.
   */
  it('counts as an answer rather than a fallback', async () => {
    await override(Season.FALL, {
      startsAt: new Date(YEAR, 7, 20),
      endsAt: new Date(YEAR, 11, 10),
    })

    const term = await getTerm(YEAR, Season.FALL)

    expect(term.fromCalendar).toBe(true)
    expect(term.overridden).toBe(true)
  })

  it('refuses a term that ends before it starts', async () => {
    const response = await override(Season.SUMMER, {
      startsAt: new Date(YEAR, 6, 1),
      endsAt: new Date(YEAR, 4, 1),
    })

    expect(response.status).toBe(400)
  })

  /** Set twice is one row, not two — the table is unique on the term. */
  it('replaces an override rather than stacking a second', async () => {
    await override(Season.SPRING, {
      startsAt: new Date(YEAR, 0, 5),
      endsAt: new Date(YEAR, 4, 1),
    })
    await override(Season.SPRING, {
      startsAt: new Date(YEAR, 0, 12),
      endsAt: new Date(YEAR, 4, 6),
      note: 'Corrected after UCF published',
    })

    const rows = await prisma.termOverride.findMany({
      where: { year: YEAR, season: Season.SPRING },
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.note).toBe('Corrected after UCF published')
    expect((await getTerm(YEAR, Season.SPRING)).startsAt.getDate()).toBe(12)
  })

  /** Removing it hands the term back to UCF, which for a far-future year means
      the fixed fallbacks. The cache has to be dropped or the desk shows the
      override it just deleted. */
  it('hands a term back when the override is removed', async () => {
    await override(Season.FALL, {
      startsAt: new Date(YEAR, 7, 20),
      endsAt: new Date(YEAR, 11, 10),
    })
    expect((await getTerm(YEAR, Season.FALL)).overridden).toBe(true)

    const response = await send(
      'DELETE',
      `/api/officer/semesters/${String(YEAR)}/FALL`,
      officerCookie,
    )

    expect(response.status).toBe(200)
    expect((await getTerm(YEAR, Season.FALL)).overridden).toBe(false)
  })

  it('records who set it', async () => {
    await override(Season.SPRING, {
      startsAt: new Date(YEAR, 0, 5),
      endsAt: new Date(YEAR, 4, 1),
    })

    const row = await prisma.termOverride.findFirst({
      where: { year: YEAR, season: Season.SPRING },
      select: { setById: true },
    })

    expect(row?.setById).toBe(officerId)
  })

  it('keeps the desk to officers', async () => {
    const memberCookie = await cookieFor(advisorId)

    const response = await app.request(
      `/api/officer/semesters/${String(YEAR)}`,
      { headers: { cookie: memberCookie } },
    )

    expect(response.status).toBe(403)
  })
})

/**
 * Handing a seat over, which is what rotation day actually is.
 *
 * The refusal above is right for an accident and wrong for a handover — eight seats changing
 * hands would be sixteen actions, and the archive would record eight people who simply stopped
 * rather than eight who were succeeded. So the take-over is one press, behind a confirmation, and
 * it writes the succession down.
 */
describe('handing a seat over', () => {
  it('still refuses by default, so nobody is displaced by accident', async () => {
    await seat(officerCookie, officerId, 'PRESIDENT')

    const response = await seat(officerCookie, advisorId, 'PRESIDENT')

    expect(response.status).toBe(409)
    expect(await openTermOf(officerId)).toMatchObject({ position: 'PRESIDENT' })
  })

  it('closes the incumbent and seats the successor in one press', async () => {
    await seat(officerCookie, officerId, 'PRESIDENT')

    const response = await send('PATCH', '/api/officer/terms/seat', officerCookie, {
      userId: advisorId,
      position: 'PRESIDENT',
      takeOver: true,
    })

    expect(response.status).toBe(200)
    // Named back, so the page can say who was succeeded rather than leaving the
    // officer to work out whether it happened.
    expect(await response.json()).toMatchObject({ succeeded: 'Board Officer' })

    expect(await openTermOf(advisorId)).toMatchObject({ position: 'PRESIDENT' })
    expect(await openTermOf(officerId)).toBeNull()
  })

  /** The succession is history, not a gap. "Stood down" and "handed over" are
      different things and the archive has to tell them apart. */
  it('records who succeeded whom', async () => {
    await seat(officerCookie, officerId, 'PRESIDENT')
    await send('PATCH', '/api/officer/terms/seat', officerCookie, {
      userId: advisorId,
      position: 'PRESIDENT',
      takeOver: true,
    })

    const closed = await prisma.officerTerm.findFirst({
      where: { userId: officerId, endedAt: { not: null } },
      select: { endedReason: true, position: true },
    })

    expect(closed?.endedReason).toBe('Succeeded by Board Advisor')
    // The seat stays on the closed row: it is the record of what they held.
    expect(closed?.position).toBe('PRESIDENT')
  })

  /**
   * One seat, one holder, at every instant. If the two writes were not in a
   * transaction a failure between them would leave the board with nobody in
   * the chair — or, in the other order, two people in it.
   */
  it('never leaves the seat held by two people', async () => {
    await seat(officerCookie, officerId, 'TREASURER')
    await send('PATCH', '/api/officer/terms/seat', officerCookie, {
      userId: advisorId,
      position: 'TREASURER',
      takeOver: true,
    })

    const holders = await prisma.officerTerm.count({
      where: { position: 'TREASURER', endedAt: null },
    })

    expect(holders).toBe(1)
  })

  it('can take over the advisor seat', async () => {
    await seat(officerCookie, advisorId, 'FACULTY_ADVISOR')

    const response = await send('PATCH', '/api/officer/terms/seat', officerCookie, {
      userId: officerId,
      position: 'FACULTY_ADVISOR',
      takeOver: true,
    })

    expect(response.status).toBe(200)
    expect(await openTermOf(advisorId)).toBeNull()
  })

  /** Somebody already on the board moves chairs rather than gaining a second
      term, take-over or not. */
  it('moves a sitting officer into the seat rather than opening a second term', async () => {
    await seat(officerCookie, officerId, 'SECRETARY')
    await seat(officerCookie, advisorId, 'MARKETING')

    await send('PATCH', '/api/officer/terms/seat', officerCookie, {
      userId: advisorId,
      position: 'SECRETARY',
      takeOver: true,
    })

    expect(
      await prisma.officerTerm.count({ where: { userId: advisorId, endedAt: null } }),
    ).toBe(1)
    expect(await openTermOf(advisorId)).toMatchObject({ position: 'SECRETARY' })
    expect(await openTermOf(officerId)).toBeNull()
  })
})

type Person = { id: string; fullName: string; discordUsername: string | null }
type Desk = {
  board: {
    id: string
    position: string | null
    user: { id: string } | null
  }[]
  offBoard: Person[]
}
type Revoked = { revoked: string[] }

const roleOf = async (userId: string) =>
  (await prisma.user.findUnique({ where: { id: userId }, select: { role: true } }))
    ?.role

const names = (people: Person[]) => people.map((person) => person.fullName)

/**
 * The seat is the officer desks. Seating somebody makes them an `OFFICER`; taking them off
 * the board hands them back to their dues; the advisor seat and `ADMIN` are the exceptions.
 */
describe('the officer desks follow the board', () => {
  it('makes whoever takes a seat an officer', async () => {
    const response = await seat(officerCookie, incomingId, 'OUTREACH')
    const body = (await response.json()) as Revoked & Record<string, unknown>

    expect(response.status).toBe(200)
    expect(await roleOf(incomingId)).toBe(UserRole.OFFICER)
    expect(body.revoked).toEqual([])
    // A board change says nothing about Discord.
    expect(body).not.toHaveProperty('discord')

    // An officer prints their year on their profile, so becoming one stamps it.
    const user = await prisma.user.findUnique({
      where: { id: incomingId },
      select: { joinedAt: true },
    })
    expect(user?.joinedAt).toBeInstanceOf(Date)
  })

  it('hands somebody stood down back to their dues', async () => {
    await seat(officerCookie, incomingId, 'OUTREACH')

    const response = await send('DELETE', `/api/officer/terms/${incomingId}`, officerCookie)
    const body = (await response.json()) as Revoked

    expect(response.status).toBe(200)
    // Paid through 2099, so a member rather than a guest.
    expect(await roleOf(incomingId)).toBe(UserRole.MEMBER)
    expect(body.revoked).toEqual([incomingId])
  })

  it('takes the desks from whoever loses a seat to a take-over', async () => {
    await seat(officerCookie, outgoingId, 'SECRETARY')
    expect(await roleOf(outgoingId)).toBe(UserRole.OFFICER)

    const response = await send('PATCH', '/api/officer/terms/seat', officerCookie, {
      userId: incomingId,
      position: 'SECRETARY',
      takeOver: true,
    })
    const body = (await response.json()) as Revoked

    expect(await roleOf(outgoingId)).toBe(UserRole.MEMBER)
    expect(await roleOf(incomingId)).toBe(UserRole.OFFICER)
    expect(body.revoked).toEqual([outgoingId])
  })

  it('never writes an admin’s role, on or off the board', async () => {
    await seat(officerCookie, adminId, 'TREASURER')
    expect(await roleOf(adminId)).toBe(UserRole.ADMIN)

    await send('DELETE', `/api/officer/terms/${adminId}`, officerCookie)
    expect(await roleOf(adminId)).toBe(UserRole.ADMIN)
  })

  /** Officers set in Prisma Studio, or left by the old Discord sync, with no place on the board. */
  it('lists officers who are not on the board, and can stand them down', async () => {
    const desk = (await (
      await send('GET', '/api/officer/terms', officerCookie)
    ).json()) as Desk

    expect(desk.offBoard.map((person) => person.id)).toContain(officerId)

    const response = await send('DELETE', `/api/officer/terms/${officerId}`, officerCookie)

    expect(response.status).toBe(200)
    expect(await roleOf(officerId)).toBe(UserRole.MEMBER)
  })

  /**
   * A seat held since an earlier day is history. Moving it closes the old term rather than
   * rewriting it, so the archive keeps the seat somebody held before.
   */
  it('keeps an older seat in the archive when somebody moves', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    await prisma.officerTerm.create({
      data: {
        userId: officerId,
        fullName: 'Board Officer',
        position: 'VICE_PRESIDENT',
        startedAt: twoDaysAgo,
      },
    })

    await seat(officerCookie, officerId, 'PRESIDENT')

    const terms = await prisma.officerTerm.findMany({
      where: { userId: officerId },
      orderBy: { startedAt: 'asc' },
      select: { position: true, endedAt: true, endedReason: true },
    })

    expect(terms).toHaveLength(2)
    expect(terms[0]).toMatchObject({
      position: 'VICE_PRESIDENT',
      endedReason: 'Moved to President',
    })
    expect(terms[0]?.endedAt).not.toBeNull()
    expect(terms[1]).toMatchObject({ position: 'PRESIDENT', endedAt: null })
  })
})

/**
 * Rotation day: the whole board in one press.
 *
 * Every plan here keeps the real board exactly as it stands (parked, so seatless) and changes
 * only this suite's people, so the route never touches a real term.
 */
describe('the handover', () => {
  const fixtureIds = () => [officerId, advisorId, adminId, outgoingId, incomingId]

  const desk = async () =>
    (await (await send('GET', '/api/officer/terms', officerCookie)).json()) as Desk

  const expectedOf = (current: Desk) =>
    current.board.map((term) => ({ id: term.id, position: term.position }))

  const others = (current: Desk) =>
    current.board.filter((term) => !(term.user && fixtureIds().includes(term.user.id)))

  /** Everybody on the board stays where they are, apart from this suite's people. */
  const keepOthers = (current: Desk) =>
    others(current).map((term) =>
      term.user
        ? { userId: term.user.id, position: term.position }
        : { termId: term.id, position: term.position },
    )

  const handover = (body: unknown, cookie = officerCookie) =>
    send('POST', '/api/officer/terms/handover', cookie, body)

  type Answer = {
    change: Revoked & { joined: Person[]; left: Person[]; moved: Person[] }
  }

  it('swaps the board in one press, roles and history together', async () => {
    await seat(officerCookie, officerId, 'PRESIDENT')
    await seat(officerCookie, outgoingId, 'TREASURER')

    const before = await desk()

    const response = await handover({
      expected: expectedOf(before),
      board: [
        ...keepOthers(before),
        { userId: officerId, position: 'PRESIDENT' },
        { userId: incomingId, position: 'TREASURER' },
        { userId: advisorId, position: 'FACULTY_ADVISOR' },
      ],
    })

    expect(response.status).toBe(200)
    const { change } = (await response.json()) as Answer

    expect(names(change.joined).sort()).toEqual(['Board Advisor', 'Board Incoming'])
    expect(names(change.left)).toEqual(['Board Outgoing'])
    expect(change.revoked).toEqual([outgoingId])
    expect(change).not.toHaveProperty('discord')

    expect(await roleOf(incomingId)).toBe(UserRole.OFFICER)
    expect(await roleOf(outgoingId)).toBe(UserRole.MEMBER)
    // The advisor joins the board and not the desks.
    expect(await roleOf(advisorId)).toBe(UserRole.MEMBER)
    expect(await openTermOf(advisorId)).toMatchObject({ position: 'FACULTY_ADVISOR' })

    const closed = await prisma.officerTerm.findFirst({
      where: { userId: outgoingId },
      select: { endedReason: true, endedAt: true },
    })
    expect(closed?.endedReason).toBe('Succeeded by Board Incoming')
    expect(closed?.endedAt).not.toBeNull()

    // Nobody else's term moved.
    const after = await desk()
    for (const term of others(before)) {
      expect(after.board).toContainEqual(
        expect.objectContaining({ id: term.id, position: term.position }),
      )
    }
  })

  it('refuses a plan made against a board that has since changed', async () => {
    const before = await desk()
    await seat(officerCookie, outgoingId, 'MARKETING')

    const response = await handover({
      expected: expectedOf(before),
      board: [...keepOthers(before), { userId: incomingId, position: 'MARKETING' }],
    })

    expect(response.status).toBe(409)
    expect(await openTermOf(incomingId)).toBeNull()
    expect(await openTermOf(outgoingId)).toMatchObject({ position: 'MARKETING' })
  })

  it('refuses one seat given twice, and one person in two places', async () => {
    const before = await desk()

    const twice = await handover({
      expected: expectedOf(before),
      board: [
        ...keepOthers(before),
        { userId: incomingId, position: 'LAB_MANAGER' },
        { userId: outgoingId, position: 'LAB_MANAGER' },
      ],
    })
    const doubled = await handover({
      expected: expectedOf(before),
      board: [
        ...keepOthers(before),
        { userId: incomingId, position: 'LAB_MANAGER' },
        { userId: incomingId, position: 'OUTREACH' },
      ],
    })

    expect(twice.status).toBe(400)
    expect(doubled.status).toBe(400)
    expect(await openTermOf(incomingId)).toBeNull()
  })

  it('is officers only', async () => {
    const before = await desk()
    const memberCookie = await cookieFor(incomingId)

    const response = await handover(
      {
        expected: expectedOf(before),
        board: [...keepOthers(before), { userId: incomingId, position: 'OUTREACH' }],
      },
      memberCookie,
    )

    expect(response.status).toBe(403)
    expect(await openTermOf(incomingId)).toBeNull()
  })
})
