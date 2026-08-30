import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.js'
import { prisma } from '../../core/db.js'
import { env } from '../../core/env.js'
import { Season, UserRole } from '../../generated/prisma/enums.js'
import { clearCalendarCache, getTerm } from '../../membership/semester.js'
import { createSession } from '../../auth/session.js'

/**
 * The two desks added with officer tenure: who sits in which seat, and when the
 * club says a semester runs.
 *
 * Both write things the rest of the site reads at request time — the board is
 * on the front page, and a term's dates decide what everybody is charged — so
 * what these assert is mostly the *refusals*: one person per seat, a term that
 * ends before it starts, an override that must not read as a guess.
 */

// Nothing in this file should reach the club's guild. These routes do not push
// roles themselves, but they share a router with ones that do, and the dev
// `.env` carries a live bot token against the real server. The rule in
// `.claude/docs/testing.md` is that anything that *can* reach `pushRoles` mocks
// this module; sharing a router is close enough to be worth not thinking about.
vi.mock('../../discord/discord.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../discord/discord.js')>()),
  officerSyncConfigured: false,
  officerRoleId: null,
  memberRoleId: null,
  projectLeadRoleId: null,
  teamLeadRoleId: null,
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

/**
 * The seats this suite borrows, and the people it borrows them from.
 *
 * The development database has a full board in it — the seed puts a placeholder
 * in all eight chairs, and a club member's box may have eight real officers —
 * so every one of these cases would otherwise 409 against somebody who is
 * genuinely sitting there. That conflict is the feature working, not a fault to
 * design around.
 *
 * So the suite *parks* whoever holds a seat it needs: their term is left open
 * and only its `position` is cleared, so nobody is stood down and nothing lands
 * on the public archive. It is handed back in `afterEach`, which keeps the
 * window to one test even if a later one fails.
 */
let parked: { id: string; position: string }[] = []

const parkSeats = async () => {
  // Every seated open term, with no attempt to exclude this suite's own: they
  // have already been deleted by `clearRows` a line earlier. An earlier version
  // tried `email: { not: { startsWith: PREFIX } }` and silently parked nothing,
  // because the seeded officers have no email at all and `NOT LIKE` against
  // NULL is NULL rather than true.
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

  const [officer, advisor, admin] = await Promise.all([
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
  ])

  officerId = officer.id
  advisorId = advisor.id
  adminId = admin.id
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
    select: { position: true, source: true, endedAt: true },
  })

describe('the seat desk', () => {
  it('puts somebody in a seat, opening a term if they had none', async () => {
    const response = await seat(officerCookie, officerId, 'TREASURER')

    expect(response.status).toBe(200)
    expect(await openTermOf(officerId)).toMatchObject({
      position: 'TREASURER',
      // Hand-appointed, which is what keeps the Discord sweep from closing it.
      source: 'MANUAL',
    })
  })

  /**
   * A seat is not a permission level. The faculty advisor sits on the board as
   * a plain `MEMBER` — that is the whole reason the two are different columns —
   * so the desk must not quietly refuse anybody who is not already an officer.
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
   * **An override must not read as a guess.** `membershipSweep` and
   * `standingRole` both stand down on `fromCalendar: false`, on the grounds
   * that guessed dates must never take somebody's membership away — and a date
   * an officer typed on purpose is the opposite of a guess. Getting this
   * backwards would quietly stop the dues sweep for any term the club had
   * corrected.
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
 * The refusal above is right for an accident and wrong for a handover — eight
 * seats changing hands would be sixteen actions, and the archive would record
 * eight people who simply stopped rather than eight who were succeeded. So the
 * take-over is one press, behind a confirmation, and it writes the succession
 * down.
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

  /** The succession is history, not a gap. "Lost the Discord role" and "handed
      over" are different things and the archive has to tell them apart. */
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

  /** Taking over a seat somebody holds by hand is a person changing a person's
      appointment, which is exactly what the `MANUAL` guard is *not* about — it
      stops the sync doing it unattended. */
  it('can take over a hand-appointed seat', async () => {
    await seat(officerCookie, advisorId, 'FACULTY_ADVISOR')
    expect(await openTermOf(advisorId)).toMatchObject({ source: 'MANUAL' })

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
