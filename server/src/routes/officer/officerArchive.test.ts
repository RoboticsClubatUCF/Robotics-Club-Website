import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.js'
import { prisma } from '../../core/db.js'
import { env } from '../../core/env.js'
import { UserRole } from '../../generated/prisma/enums.js'
import { createSession } from '../../auth/session.js'

/**
 * The officers desk: the club's own record of who has run it.
 *
 * What's worth asserting isn't that a row can be written — every desk can do that — but the three
 * rules that make an archive different from a board. One person may hold as many terms as they
 * served, so nothing is keyed on a person. The one-per-seat rule applies to open terms and
 * nothing else, because forty people have been president. And a term needs no account behind it,
 * which is the case every other route that touches `officer_terms` can't express.
 *
 * The fourth is `/members`: a closed term is what makes somebody an officer alumnus now, alongside
 * the Discord role, and the two must not have become one writer of one column.
 *
 * Nothing here should reach the club's guild. These routes push no roles, but they share an app
 * with ones that do and the dev `.env` carries a live bot token.
 */
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

const PREFIX = 'test-archive-'
const email = (name: string) => `${PREFIX}${name}@ucf.edu`

/**
 * Every fixture term carries the prefix in its `fullName`, and the cleanup deletes on that column.
 * A term with no `userId` is reachable by no cascade — that's the whole point of the route — so
 * deleting the suite's people would leave its archive rows in the club's database, which is
 * exactly how `tasks.test.ts` leaked seventeen rows. Namespace by whatever column the row can
 * actually be found by.
 */
const held = (name: string) => `${PREFIX}${name}`

/** Paid through, because every officer route ends in `requireCurrentDues`. */
const PAID_THROUGH = new Date(2099, 11, 31)

/** Far enough back that no real term shares the year and the archive's academic
    grouping is unambiguous. August is the cut-over, so these are 1987–1988. */
const FROM = new Date('1987-09-01T12:00:00Z')
const TO = new Date('1988-05-01T12:00:00Z')

const clearWindows = () =>
  prisma.rateLimit.deleteMany({
    where: { key: { in: ['officer', 'officer-photo'] } },
  })

const clearRows = async () => {
  // Terms first and by name, not by the people: half of them have no `userId`
  // by design, so no cascade from `users` reaches them.
  await prisma.officerTerm.deleteMany({
    where: { fullName: { startsWith: PREFIX } },
  })
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
}

async function cookieFor(userId: string): Promise<string> {
  const { token } = await createSession(userId)
  return `${env.SESSION_COOKIE_NAME}=${token}`
}

const send = (method: string, path: string, cookie: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: {
      cookie,
      origin: env.SITE_URL,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

type Term = {
  id: string
  position: string | null
  startedAt: string
  endedAt: string | null
  endedReason: string | null
  source: string
  fullName: string
  photoUrl: string | null
  user: { id: string; fullName: string } | null
}

let officerCookie = ''
let memberCookie = ''
let officerId = ''

beforeEach(async () => {
  await clearWindows()
  await clearRows()

  const [officer, member] = await Promise.all([
    prisma.user.create({
      data: {
        fullName: 'Archive Officer',
        email: email('officer'),
        role: UserRole.OFFICER,
        duesPaidThrough: PAID_THROUGH,
      },
    }),
    prisma.user.create({
      data: {
        fullName: 'Archive Member',
        email: email('member'),
        role: UserRole.MEMBER,
        duesPaidThrough: PAID_THROUGH,
      },
    }),
  ])

  officerId = officer.id
  officerCookie = await cookieFor(officer.id)
  memberCookie = await cookieFor(member.id)
})

afterAll(async () => {
  await clearWindows()
  await clearRows()
  await prisma.$disconnect()
})

/** A finished term, which is the shape the archive is made of. */
const add = (body: Record<string, unknown>, cookie = officerCookie) =>
  send('POST', '/api/officer/archive', cookie, {
    startedAt: FROM.toISOString(),
    endedAt: TO.toISOString(),
    ...body,
  })

const ours = (terms: Term[]) =>
  terms.filter((term) => term.fullName.startsWith(PREFIX))

describe('adding a term', () => {
  /**
   * The case no other route on this site can express. Every past officer the
   * club had before it had a website has no row in `users`, and a required
   * relation would make half the archive unenterable.
   */
  it('records somebody who has no account at all', async () => {
    const response = await add({
      fullName: held('Marisol Vega'),
      position: 'PRESIDENT',
    })

    expect(response.status).toBe(201)

    const term = (await response.json()) as Term
    expect(term.user).toBeNull()
    expect(term.fullName).toBe(held('Marisol Vega'))
    // Hand-written, which is what keeps the Discord sweep from closing it. The
    // faculty advisor depends on the same property.
    expect(term.source).toBe('MANUAL')
  })

  /**
   * The whole reason this is a table and not a column on `users`: somebody who
   * served four years is four rows, and every one of them is the record of a
   * year rather than an edit to the one before it.
   */
  it('lets one person hold several terms, in different seats', async () => {
    const first = await add({
      fullName: held('Priya Raman'),
      userId: officerId,
      position: 'SECRETARY',
    })
    const second = await add({
      fullName: held('Priya Raman'),
      userId: officerId,
      position: 'PRESIDENT',
      startedAt: '1989-09-01T12:00:00Z',
      endedAt: '1990-05-01T12:00:00Z',
    })

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)

    const listed = await send('GET', '/api/officer/archive', officerCookie)
    const { terms } = (await listed.json()) as { terms: Term[] }

    expect(ours(terms)).toHaveLength(2)
    // Both link the same account, and neither replaced the other.
    expect(ours(terms).every((term) => term.user?.id === officerId)).toBe(true)
  })

  /**
   * The one-per-seat rule is about *open* terms and nothing else. If it reached
   * closed ones the archive could hold one president, which is not an archive.
   */
  it('allows any number of finished terms in the same seat', async () => {
    const first = await add({ fullName: held('One'), position: 'TREASURER' })
    const second = await add({
      fullName: held('Two'),
      position: 'TREASURER',
      startedAt: '1988-09-01T12:00:00Z',
      endedAt: '1989-05-01T12:00:00Z',
    })

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
  })

  /**
   * And still refuses two people sitting in one chair *today*, naming the
   * incumbent. The desk sends the officer to the roles desk rather than growing
   * a second, quieter way to stand somebody down.
   */
  it('refuses a second open term in the same seat, and says who holds it', async () => {
    const first = await add({
      fullName: held('Sitting'),
      position: 'MARKETING',
      endedAt: null,
    })

    // Only meaningful if the seat was free to begin with; the dev database has
    // a full board, so skip rather than assert against somebody real.
    if (first.status === 409) return

    const second = await add({
      fullName: held('Usurper'),
      position: 'MARKETING',
      endedAt: null,
    })

    expect(second.status).toBe(409)
    expect(await second.text()).toContain(held('Sitting'))
  })

  it('refuses a term that ends before it starts', async () => {
    const response = await add({
      fullName: held('Backwards'),
      startedAt: TO.toISOString(),
      endedAt: FROM.toISOString(),
    })

    expect(response.status).toBe(400)
  })

  it('refuses an account that does not exist', async () => {
    const response = await add({
      fullName: held('Ghost'),
      userId: '00000000-0000-0000-0000-000000000000',
    })

    expect(response.status).toBe(404)
  })

  it('is officers only', async () => {
    const response = await add({ fullName: held('Nope') }, memberCookie)

    expect(response.status).toBe(403)
  })
})

describe('editing and removing a term', () => {
  const seed = async () => {
    const response = await add({ fullName: held('Dana Okafor') })
    return (await response.json()) as Term
  }

  it('corrects the seat, the dates and the name', async () => {
    const term = await seed()

    const response = await send(
      'PATCH',
      `/api/officer/archive/${term.id}`,
      officerCookie,
      {
        fullName: held('Dana Okafor-Bell'),
        position: 'OUTREACH',
        endedReason: 'Graduated',
      },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      fullName: held('Dana Okafor-Bell'),
      position: 'OUTREACH',
      endedReason: 'Graduated',
    })
  })

  /**
   * Absent is not null. A save that only moved a date must not wipe the
   * succession note off the row it is fixing.
   */
  it('leaves out what the body left out', async () => {
    const term = await seed()

    await send('PATCH', `/api/officer/archive/${term.id}`, officerCookie, {
      endedReason: 'Succeeded by somebody',
    })

    const response = await send(
      'PATCH',
      `/api/officer/archive/${term.id}`,
      officerCookie,
      { startedAt: '1987-10-01T12:00:00Z' },
    )

    expect(await response.json()).toMatchObject({
      endedReason: 'Succeeded by somebody',
    })
  })

  /**
   * Checked against the row as it will be, not against the body — otherwise a
   * `PATCH` that moves only the start date sails past a `endedAt` already on
   * the record.
   */
  it('refuses a start date that lands after the end date already stored', async () => {
    const term = await seed()

    const response = await send(
      'PATCH',
      `/api/officer/archive/${term.id}`,
      officerCookie,
      { startedAt: '1999-01-01T12:00:00Z' },
    )

    expect(response.status).toBe(400)
  })

  it('deletes a term outright', async () => {
    const term = await seed()

    const response = await send(
      'DELETE',
      `/api/officer/archive/${term.id}`,
      officerCookie,
    )

    expect(response.status).toBe(200)
    expect(
      await prisma.officerTerm.findUnique({ where: { id: term.id } }),
    ).toBeNull()
  })

  it('404s on a term that is not there', async () => {
    const response = await send(
      'DELETE',
      '/api/officer/archive/00000000-0000-0000-0000-000000000000',
      officerCookie,
    )

    expect(response.status).toBe(404)
  })

  it('is officers only', async () => {
    const term = await seed()

    const response = await send(
      'DELETE',
      `/api/officer/archive/${term.id}`,
      memberCookie,
    )

    expect(response.status).toBe(403)
  })
})

/**
 * The archive's other job.
 *
 * ALUMNI on `/members` used to be the Discord role alone, because `OfficerTerm` only reached back
 * as far as the sync did. This desk closed that gap, so a closed term files somebody under ALUMNI
 * without anybody touching Discord — and without a second writer of `User.officerAlumnus`. The
 * flag is still the sweep's and only the sweep's; the roster reads the two together.
 */
describe('a closed term makes somebody an officer alumnus', () => {
  type Member = { id: string; fullName: string; officerAlumnus: boolean }

  const roster = async (status: string) => {
    const response = await app.request(`/api/members?status=${status}&limit=1000`)
    return (await response.json()) as Member[]
  }

  const mine = (rows: Member[]) => rows.find((row) => row.id === officerId)

  it('files them under alumni on the closed term alone', async () => {
    const before = await roster('alumni')
    expect(mine(before)).toBeUndefined()

    await add({ fullName: held('Alum'), userId: officerId })

    expect(mine(await roster('alumni'))?.officerAlumnus).toBe(true)
    // And still under ACTIVE MEMBERS, which is dues standing rather than the
    // absence of a term. The two chips overlap on purpose — see `rosterStatus`
    // — and this fixture is exactly the case: a sitting officer, paid through,
    // with a closed term behind them.
    expect(mine(await roster('active'))).toBeDefined()
  })

  /** An *open* term is somebody still on the board, not an alumnus. */
  it('does not count a term that has not ended', async () => {
    await add({ fullName: held('Sitting'), userId: officerId, endedAt: null })

    expect(mine(await roster('alumni'))).toBeUndefined()
  })

  /**
   * The column stays the sweep's. Reading the archive beside it must not have
   * turned the desk into a second owner of `User.officerAlumnus`, which is the
   * failure mode `active` already demonstrated.
   */
  it('never writes the Discord flag', async () => {
    await add({ fullName: held('Alum'), userId: officerId })

    expect(
      await prisma.user.findUnique({
        where: { id: officerId },
        select: { officerAlumnus: true },
      }),
    ).toMatchObject({ officerAlumnus: false })
  })

  /** Several terms is still one person, listed once. */
  it('lists somebody with four terms exactly once', async () => {
    for (const year of [1987, 1988, 1989, 1990]) {
      await add({
        fullName: held('Alum'),
        userId: officerId,
        startedAt: `${String(year)}-09-01T12:00:00Z`,
        endedAt: `${String(year + 1)}-05-01T12:00:00Z`,
      })
    }

    const alumni = await roster('alumni')

    expect(alumni.filter((row) => row.id === officerId)).toHaveLength(1)
  })
})
