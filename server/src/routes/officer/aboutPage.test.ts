import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.js'
import { prisma } from '../../core/db.js'
import { env } from '../../core/env.js'
import { UserRole } from '../../generated/prisma/enums.js'
import { clearCalendarCache } from '../../membership/semester.js'
import { createSession } from '../../auth/session.js'
import { STORED_PREFIX } from '../../files/files.js'
import { FileKind } from '../../generated/prisma/enums.js'
import { ABOUT_ROW, MAX_MILESTONES, MAX_STATS } from './aboutPage.js'

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
 *
 * `about_stats` is borrowed the same way. A case that saves its own timeline takes the club's
 * photos off it, and the route deletes a removed photo's file, so `deleteIfStored` is guarded
 * here to delete only files this suite uploaded (named with the prefix). A run killed between a
 * case and its `afterEach` can't cost the club a photo. The files are borrowed too, bytes and
 * all, in case the guard is ever taken out.
 */

const { PREFIX } = vi.hoisted(() => ({ PREFIX: 'test-about-' }))

vi.mock('../../files/files.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../files/files.js')>()
  const { prisma: db } = await import('../../core/db.js')

  return {
    ...actual,
    deleteIfStored: async (url: string | null | undefined) => {
      if (!url?.startsWith(actual.STORED_PREFIX)) return
      const file = await db.storedFile.findUnique({
        where: { id: url.slice(actual.STORED_PREFIX.length) },
        select: { originalName: true },
      })
      if (file?.originalName.startsWith(PREFIX)) await actual.deleteIfStored(url)
    },
  }
})

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
  stats: [
    { figure: '50+ years', label: 'of robotics at UCF' },
    { figure: '$15,000 annually', label: 'in funding' },
  ],
  milestones: [
    { when: '1972', what: 'The club is founded.', photo: null },
    { when: '1998', what: 'Something else happens.', photo: null },
  ],
}

/** Enough of a PNG for the magic-number check, named so the cleanup can find it. */
const png = (name = 'photo.png') =>
  new File(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])],
    `${PREFIX}${name}`,
    { type: 'image/png' },
  )

const clearWindows = () =>
  prisma.rateLimit.deleteMany({ where: { key: { startsWith: 'officer:' } } })

const clearRows = () =>
  prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })

/** Files this suite uploaded. `createdById` is `SetNull`, so the prefix is what finds them. */
const clearFiles = () =>
  prisma.storedFile.deleteMany({ where: { originalName: { startsWith: PREFIX } } })

let officerCookie = ''
let memberCookie = ''

/** The club's own page and timeline, put back after every case. */
let borrowedPage: Awaited<ReturnType<typeof prisma.aboutPage.findUnique>> = null
let borrowedTimeline: Awaited<ReturnType<typeof prisma.aboutMilestone.findMany>> = []
let borrowedStats: Awaited<ReturnType<typeof prisma.aboutStat.findMany>> = []
let borrowedFiles: Awaited<ReturnType<typeof prisma.storedFile.findMany>> = []

/**
 * Hono matches paths strictly, so the page's own route is `''` rather than `'/'`
 * — `/api/officer/about/` with the slash on the end is a 404, and one that reads
 * exactly like a router nobody mounted.
 */
const write = async (body?: unknown, cookie = officerCookie) =>
  app.request('/api/officer/about', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Origin: env.allowedOrigins[0] ?? 'http://localhost:5173',
      Cookie: cookie,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(await current(body)) }),
  })

/** A body saved from the page as it stands now, unless the case sends its own `version`. */
const current = async (body: unknown) =>
  body !== null && typeof body === 'object' && !('version' in body)
    ? { ...body, version: (await read()).updatedAt }
    : body

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
  updatedAt: string | null
  stats: { id: string; figure: string; label: string }[]
  milestones: {
    id: string
    when: string
    what: string
    imageUrl: string | null
    imageCaption: string | null
    focalX: number
    focalY: number
    zoom: number
  }[]
}

const read = async () =>
  (await (await app.request('/api/about')).json()) as WireAbout

/** A save carrying files: the page as JSON in `page`, each photo as its own part. */
const writeForm = async (body: unknown, photos: Record<string, File> = {}) => {
  const form = new FormData()
  form.append('page', JSON.stringify(await current(body)))
  for (const [name, file] of Object.entries(photos)) form.append(name, file)

  return app.request('/api/officer/about', {
    method: 'PUT',
    headers: {
      Origin: env.allowedOrigins[0] ?? 'http://localhost:5173',
      Cookie: officerCookie,
    },
    body: form,
  })
}

const fileExists = async (url: string) =>
  (await prisma.storedFile.count({
    where: { id: url.slice(STORED_PREFIX.length) },
  })) === 1

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
  borrowedTimeline = await prisma.aboutMilestone.findMany()
  borrowedStats = await prisma.aboutStat.findMany()
  borrowedFiles = await prisma.storedFile.findMany({
    where: {
      id: {
        in: borrowedTimeline.flatMap((row) =>
          row.imageUrl?.startsWith(STORED_PREFIX)
            ? [row.imageUrl.slice(STORED_PREFIX.length)]
            : [],
        ),
      },
    },
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

/** Everything this suite borrowed, handed back, ids included. The files go first, since a
    case may have deleted one the club's timeline points at. */
const restore = async () => {
  if (borrowedFiles.length > 0) {
    await prisma.storedFile.createMany({ data: borrowedFiles, skipDuplicates: true })
  }

  await prisma.aboutMilestone.deleteMany()
  if (borrowedTimeline.length > 0) {
    await prisma.aboutMilestone.createMany({ data: borrowedTimeline })
  }

  await prisma.aboutStat.deleteMany()
  if (borrowedStats.length > 0) {
    await prisma.aboutStat.createMany({ data: borrowedStats })
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
  await clearFiles()
})

afterAll(async () => {
  await clearRows()
  await clearFiles()
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

    await write({
      ...PAGE,
      milestones: [{ when: '2026', what: 'Only this.', photo: null }],
    })

    const timeline = (await read()).milestones
    expect(timeline).toHaveLength(1)
    expect(timeline[0]?.what).toBe('Only this.')
  })

  it('keeps the timeline in the order it was sent', async () => {
    await write({
      ...PAGE,
      milestones: [
        { when: 'Third', what: 'c', photo: null },
        { when: 'First', what: 'a', photo: null },
        { when: 'Second', what: 'b', photo: null },
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
        photo: null,
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

describe('the numbers', () => {
  it('replaces them in the order they were sent', async () => {
    await write(PAGE)
    expect((await read()).stats.map((stat) => stat.figure)).toEqual([
      '50+ years',
      '$15,000 annually',
    ])

    await write({ ...PAGE, stats: [{ figure: '7 active projects', label: 'x' }] })

    expect((await read()).stats.map((stat) => stat.figure)).toEqual([
      '7 active projects',
    ])
  })

  it('refuses more cells than the row holds', async () => {
    const response = await write({
      ...PAGE,
      stats: Array.from({ length: MAX_STATS + 1 }, () => ({
        figure: '1',
        label: 'x',
      })),
    })

    expect(response.status).toBe(400)
  })

  /**
   * An editor loaded before the numbers existed sends no `stats`. Defaulting them to empty
   * would have that officer's save wipe the club's numbers and every timeline photo.
   */
  it('turns away an out-of-date editor rather than wiping the numbers', async () => {
    await write(PAGE)

    const { stats, ...stale } = PAGE
    void stats
    const response = await write({
      ...stale,
      milestones: [{ when: '1972', what: 'The club is founded.' }],
    })

    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: string }).error).toMatch(/reload/i)
    expect((await read()).stats).toHaveLength(2)
  })
})

describe('timeline photos', () => {
  const withPhoto = {
    ...PAGE,
    milestones: [
      {
        when: '1972',
        what: 'The club is founded.',
        photo: { upload: 'photo-0' },
        imageCaption: 'The first meeting',
        focalX: 30,
        focalY: 60,
        zoom: 1.5,
      },
      { when: '1998', what: 'Something else happens.', photo: null },
    ],
  }

  it('stores an uploaded photo with its caption and framing', async () => {
    const response = await writeForm(withPhoto, { 'photo-0': png() })
    expect(response.status).toBe(200)

    const [line, bare] = (await read()).milestones

    expect(line?.imageUrl?.startsWith(STORED_PREFIX)).toBe(true)
    expect(line?.imageCaption).toBe('The first meeting')
    expect([line?.focalX, line?.focalY, line?.zoom]).toEqual([30, 60, 1.5])
    expect(bare?.imageUrl).toBeNull()
    expect(await fileExists(line?.imageUrl ?? '')).toBe(true)
  })

  it('keeps a photo across a save that moves its line', async () => {
    await writeForm(withPhoto, { 'photo-0': png() })
    const url = (await read()).milestones[0]?.imageUrl ?? ''

    const response = await write({
      ...PAGE,
      milestones: [
        { when: '1998', what: 'Something else happens.', photo: null },
        { when: '1972', what: 'The club is founded.', photo: { keep: url } },
      ],
    })

    expect(response.status).toBe(200)
    expect((await read()).milestones[1]?.imageUrl).toBe(url)
    expect(await fileExists(url)).toBe(true)
  })

  it('deletes the file once no line holds the photo', async () => {
    await writeForm(withPhoto, { 'photo-0': png() })
    const url = (await read()).milestones[0]?.imageUrl ?? ''

    expect((await write(PAGE)).status).toBe(200)

    expect((await read()).milestones.every((row) => row.imageUrl === null)).toBe(true)
    expect(await fileExists(url)).toBe(false)
  })

  /** The guard that stops a save adopting somebody else's picture and then deleting it. */
  it('refuses to keep a photo that is not on the timeline, and leaves its file alone', async () => {
    const other = await prisma.storedFile.create({
      data: {
        kind: FileKind.IMAGE,
        mimeType: 'image/png',
        byteSize: 3,
        originalName: `${PREFIX}elsewhere.png`,
        data: new Uint8Array([1, 2, 3]),
      },
    })
    const url = `${STORED_PREFIX}${other.id}`

    const response = await write({
      ...PAGE,
      milestones: [{ when: '1972', what: 'x', photo: { keep: url } }],
    })
    expect(response.status).toBe(409)

    await write(PAGE)
    expect(await fileExists(url)).toBe(true)
  })

  it('refuses a file that is not an image, and stores nothing', async () => {
    const text = new File(['not a picture'], `${PREFIX}notes.png`, {
      type: 'image/png',
    })

    const response = await writeForm(withPhoto, { 'photo-0': text })

    expect(response.status).toBe(400)
    expect(
      await prisma.storedFile.count({
        where: { originalName: { startsWith: PREFIX } },
      }),
    ).toBe(0)
  })

  it('refuses a photo the request does not carry', async () => {
    expect((await writeForm(withPhoto)).status).toBe(400)
  })

  /** Officer A opened the editor, officer B added a photo and saved, then A saved. */
  it('won’t let an editor opened earlier delete a photo added since', async () => {
    const opened = (await read()).updatedAt
    await writeForm(withPhoto, { 'photo-0': png() })
    const url = (await read()).milestones[0]?.imageUrl ?? ''

    const response = await write({ ...PAGE, version: opened })

    expect(response.status).toBe(409)
    expect((await read()).milestones[0]?.imageUrl).toBe(url)
    expect(await fileExists(url)).toBe(true)
  })
})

describe('saving over somebody else', () => {
  it('refuses a save from an editor opened before the last save', async () => {
    const opened = (await read()).updatedAt
    await write(PAGE)

    const response = await write({ ...PAGE, heading: 'Stale.', version: opened })

    expect(response.status).toBe(409)
    expect((await read()).heading).toBe(PAGE.heading)
  })

  /** What a bundle gets while the deploy is still restarting the API before it: no version. */
  it('refuses a save that loaded no version once the page exists', async () => {
    await write(PAGE)

    expect((await write({ ...PAGE, stats: [], version: null })).status).toBe(409)
    expect((await read()).stats).toHaveLength(2)
  })

  it('answers with the new version, so the same editor can save twice', async () => {
    const first = (await (await write(PAGE)).json()) as WireAbout

    const response = await write({ ...PAGE, lede: 'Again.', version: first.updatedAt })

    expect(response.status).toBe(200)
  })
})
