import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.js'
import { prisma } from '../../core/db.js'
import { env } from '../../core/env.js'
import { UserRole } from '../../generated/prisma/enums.js'
import { clearCalendarCache } from '../../membership/semester.js'
import { createSession } from '../../auth/session.js'
import { ABOUT_ROW, MAX_MILESTONES } from './aboutPage.js'

/**
 * `/about`, as officers write it.
 *
 * Both tables are borrowed whole, and this suite is the strongest borrow in the repository.
 * `about_page` is one row keyed `current`, the way `sponsorship_sheet` is — read before each test,
 * put back after, and deleted if there was none, which is the state a freshly migrated database is
 * in. `about_milestones` cannot be namespaced at all: the route takes the whole timeline in one
 * body and replaces the table, so a prefixed fixture would be deleted by the very request it was
 * written for. The club's lines are therefore read in `beforeEach` and written back in `afterEach`,
 * and every case that saves sends its own timeline knowing the real one is coming back.
 *
 * That is a bigger promise than the other suites make, and it is the price of a page that saves
 * atomically — see the note on the transaction in `aboutPage.ts`. Nothing else on this API deletes
 * a table without a filter.
 */

const PREFIX = 'test-about-'
const email = (name: string) => `${PREFIX}${name}@ucf.edu`

const PAID_THROUGH = new Date(2099, 11, 31)
const SURVEYED = new Date('2035-09-01T00:00:00')

/** The whole of the page, as the route demands it — `PUT` takes everything or
    nothing, so every case that writes starts from this. */
const PAGE = {
  heading: 'Building robots at UCF since 1972.',
  lede: 'A paragraph under the heading.',
  storyNotice: 'The history below is placeholder text.',
  story: ['One.', 'Two.'],
  labBuilding: 'Institute for Simulation & Training',
  labStreet: '3100 Technology Pkwy',
  labCity: 'Orlando, FL 32826',
  labMapUrl: 'https://maps.example.com/ist',
  onlineBlurb: 'Discord is where the club talks.',
  milestones: [
    { when: '1972', what: 'The club is founded.' },
    { when: '1998', what: 'Something else happens.' },
  ],
}

const clearWindows = () =>
  prisma.rateLimit.deleteMany({ where: { key: { startsWith: 'officer:' } } })

const clearRows = () =>
  prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })

let officerCookie = ''
let memberCookie = ''

/** The club's own page and timeline, put back after every case. */
let borrowedPage: Awaited<ReturnType<typeof prisma.aboutPage.findUnique>> = null
let borrowedTimeline: { when: string; what: string; sortOrder: number }[] = []

/**
 * Hono matches paths strictly, so the page's own route is `''` rather than `'/'`
 * — `/api/officer/about/` with the slash on the end is a 404, and one that reads
 * exactly like a router nobody mounted.
 */
const write = (body?: unknown, cookie = officerCookie) =>
  app.request('/api/officer/about', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Origin: env.allowedOrigins[0] ?? 'http://localhost:5173',
      Cookie: cookie,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

/** The page as the public route answers it, which is what both `/about` and its
    editor read. */
type WireAbout = {
  heading: string
  lede: string
  storyNotice: string | null
  story: string[]
  labBuilding: string | null
  labStreet: string | null
  labCity: string | null
  labMapUrl: string | null
  onlineBlurb: string
  milestones: { id: string; when: string; what: string }[]
}

const read = async () =>
  (await (await app.request('/api/about')).json()) as WireAbout

beforeEach(async () => {
  // `requireCurrentDues` reads UCF's calendar. Stubbed to fail, which puts the
  // fixed fallback dates in play — the fixtures are paid through 2099, so what
  // the term turns out to be cannot decide any of these cases.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('nope', { status: 503 }))),
  )
  clearCalendarCache()

  await clearWindows()
  await clearRows()

  borrowedPage = await prisma.aboutPage.findUnique({ where: { id: ABOUT_ROW } })
  borrowedTimeline = await prisma.aboutMilestone.findMany({
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { when: true, what: true, sortOrder: true },
  })

  const [officer, member] = await Promise.all([
    prisma.user.create({
      data: {
        fullName: 'About Officer',
        email: email('officer'),
        role: UserRole.OFFICER,
        duesPaidThrough: PAID_THROUGH,
        surveyCompletedAt: SURVEYED,
      },
    }),
    prisma.user.create({
      data: {
        fullName: 'About Member',
        email: email('member'),
        role: UserRole.MEMBER,
        duesPaidThrough: PAID_THROUGH,
        surveyCompletedAt: SURVEYED,
      },
    }),
  ])

  officerCookie = `${env.SESSION_COOKIE_NAME}=${(await createSession(officer.id)).token}`
  memberCookie = `${env.SESSION_COOKIE_NAME}=${(await createSession(member.id)).token}`
})

/** Everything this suite borrowed, handed back. The rows come back with new
    ids, which nothing on the page and nothing in the database depends on. */
const restore = async () => {
  await prisma.aboutMilestone.deleteMany()
  if (borrowedTimeline.length > 0) {
    await prisma.aboutMilestone.createMany({ data: borrowedTimeline })
  }

  if (borrowedPage) {
    const { id, updatedAt, ...copy } = borrowedPage
    void updatedAt
    await prisma.aboutPage.upsert({
      where: { id },
      create: borrowedPage,
      update: copy,
    })
  } else {
    await prisma.aboutPage.deleteMany({ where: { id: ABOUT_ROW } })
  }
}

afterEach(async () => {
  vi.unstubAllGlobals()
  await restore()
})

afterAll(async () => {
  await clearRows()
  await clearWindows()
})

describe('saving the page', () => {
  it('writes the whole page and reads it back', async () => {
    expect((await write(PAGE)).status).toBe(200)

    const page = await read()

    expect(page.heading).toBe(PAGE.heading)
    expect(page.story).toEqual(['One.', 'Two.'])
    expect(page.labStreet).toBe('3100 Technology Pkwy')
  })

  it('replaces the timeline rather than appending to it', async () => {
    await write(PAGE)
    expect((await read()).milestones).toHaveLength(2)

    await write({ ...PAGE, milestones: [{ when: '2026', what: 'Only this.' }] })

    const timeline = (await read()).milestones
    expect(timeline).toHaveLength(1)
    expect(timeline[0]?.what).toBe('Only this.')
  })

  it('keeps the timeline in the order it was sent', async () => {
    await write({
      ...PAGE,
      milestones: [
        { when: 'Third', what: 'c' },
        { when: 'First', what: 'a' },
        { when: 'Second', what: 'b' },
      ],
    })

    expect((await read()).milestones.map((row) => row.when)).toEqual([
      'Third',
      'First',
      'Second',
    ])
  })

  it('empties the timeline when the last line is removed', async () => {
    await write(PAGE)

    expect((await write({ ...PAGE, milestones: [] })).status).toBe(200)
    expect((await read()).milestones).toEqual([])
  })

  it('takes the placeholder notice off the page when it is cleared', async () => {
    await write(PAGE)
    expect((await read()).storyNotice).toBe(PAGE.storyNotice)

    // An empty box and a null mean the same thing, and both of them are the
    // club having written its own history — which is the whole reason this is a
    // column rather than a panel in the component.
    expect((await write({ ...PAGE, storyNotice: '' })).status).toBe(200)
    expect((await read()).storyNotice).toBeNull()
  })

  it('takes the address off rather than printing half of one', async () => {
    await write(PAGE)

    const response = await write({
      ...PAGE,
      labBuilding: '',
      labStreet: '',
      labCity: '',
      labMapUrl: '',
    })

    expect(response.status).toBe(200)

    const page = await read()
    expect(page.labBuilding).toBeNull()
    expect(page.labStreet).toBeNull()
    expect(page.labCity).toBeNull()
    expect(page.labMapUrl).toBeNull()
  })

  it('answers with the page it just saved, so the editor needs no second read', async () => {
    const saved = (await (await write(PAGE)).json()) as WireAbout

    expect(saved.heading).toBe(PAGE.heading)
    expect(saved.milestones.map((row) => row.when)).toEqual(['1972', '1998'])
  })

  it('refuses an empty heading', async () => {
    expect((await write({ ...PAGE, heading: '  ' })).status).toBe(400)
  })

  it('refuses a timeline longer than the page will draw', async () => {
    const response = await write({
      ...PAGE,
      milestones: Array.from({ length: MAX_MILESTONES + 1 }, (_, index) => ({
        when: String(1972 + index),
        what: 'Something happened.',
      })),
    })

    expect(response.status).toBe(400)
  })

  it('leaves the timeline alone when the copy is refused', async () => {
    await write(PAGE)

    // The transaction is the whole point of the shape: a body the schema turns
    // away must never reach the `deleteMany` that clears the timeline.
    await write({ ...PAGE, heading: '', milestones: [] })

    expect((await read()).milestones).toHaveLength(2)
  })

  it('refuses a member, and a caller with no session at all', async () => {
    expect((await write(PAGE, memberCookie)).status).toBe(403)
    expect((await write(PAGE, '')).status).toBe(401)
  })

  it('serves the page before anybody has written it', async () => {
    await prisma.aboutPage.deleteMany({ where: { id: ABOUT_ROW } })

    const page = await read()

    // Not the exact sentence — that would be this suite asserting the club's own
    // copy. What matters is that a database with no row still serves a page.
    expect(page.heading.length).toBeGreaterThan(0)
    expect(page.lede.length).toBeGreaterThan(0)
    expect(Array.isArray(page.milestones)).toBe(true)
  })
})
