import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { app } from '../../app.js'
import { prisma } from '../../core/db.js'
import { Season } from '../../generated/prisma/enums.js'
import { clearCalendarCache } from '../../membership/semester.js'

/**
 * Integration tests against a live database — see the note in vitest.config.ts.
 * `app.request()` drives the real Hono app in-process, so no port is bound and
 * no server has to be running.
 *
 * These deliberately assert on invariants rather than on specific numbers. The
 * database they run against is whatever the last seed left behind, and a test
 * that hard-codes "5 projects" is a test that breaks the first time someone
 * adds one.
 */

/**
 * `Response.json()` is typed `unknown`, so callers say what they expect. These
 * shapes are only as much of each payload as the assertions below touch.
 */
type Stats = { projects: number; members: number; events: number }
/** `slug` is nullable, and is null for almost everybody — it means "has a
    public profile URL", not "is on the roster". See `rosterSelect`. */
type Member = {
  id: string
  slug: string | null
  role: string
  fullName: string
  active: boolean
  officerAlumnus: boolean
}
/** Both officer routes answer with this — they are one table split on `endedAt`. */
type OfficerTerm = {
  id: string
  position: string | null
  startedAt: string
  endedAt: string | null
  fullName: string
  photoUrl: string | null
  profileUrl: string | null
}
type Project = { slug: string }
/** What the term filters are asserted on — the pair, plus the slug that
    identifies the row across three responses. */
type Term = { slug: string; termYear: number; termSeason: string }
type ProjectDetail = {
  images: {
    id: string
    url: string
    caption: string | null
    focalX: number
    focalY: number
    zoom: number
  }[]
  links: { id: string; label: string; url: string }[]
}
type Event = { slug: string; startsAt: string; endsAt: string | null }
type Sponsor = { name: string; tier: string }

const get = async <T>(path: string): Promise<T> => {
  const response = await app.request(path)
  expect(response.status, `GET ${path}`).toBe(200)
  return (await response.json()) as T
}

const sameDay = (a: string, b: string) => a.slice(0, 10) === b.slice(0, 10)

/**
 * Which academic year a term began in, August to August.
 *
 * Written out here rather than imported so that it is an independent statement
 * of the rule: the route windows on this in SQL and
 * `web/src/lib/officerTerms.ts` groups on it in the browser, and a test that
 * shared an implementation with either could not notice them drifting apart.
 * UTC, for the reason that file gives — midnight on 1 August is the previous
 * July in Orlando.
 */
const academicYearOf = (iso: string): number => {
  const at = new Date(iso)
  return at.getUTCMonth() >= 7 ? at.getUTCFullYear() : at.getUTCFullYear() - 1
}

afterAll(async () => {
  await prisma.$disconnect()
})

describe('GET /api/health', () => {
  it('reports the database as reachable', async () => {
    const body = await get<{ status: string; database: string }>('/api/health')
    expect(body).toEqual({ status: 'ok', database: 'up' })
  })
})

describe('GET /api/stats', () => {
  it('returns a non-negative integer for each count', async () => {
    const stats = await get<Stats>('/api/stats')

    expect(Object.keys(stats).sort()).toEqual(['events', 'members', 'projects'])
    for (const [key, value] of Object.entries(stats)) {
      expect(Number.isInteger(value), `${key} should be an integer`).toBe(true)
      expect(value as number).toBeGreaterThanOrEqual(0)
    }
  })

  /**
   * The contract the landing page is built on: a stat cell links to a listing,
   * and the number on the cell is how many rows that listing has. If a filter
   * is ever added to one side and not the other, this is what catches it.
   * `limit` is pushed past the defaults so a large table can't make a genuine
   * disagreement look like pagination.
   *
   * **`members` is deliberately not held to it**, which is why the cell is
   * labelled ACTIVE MEMBERS rather than MEMBERS. The listing is every account;
   * the count is the club's active membership. All that is asserted here is the
   * direction — the listing can only ever be the larger of the two — and the
   * exact figure is pinned by "counts the active membership in /stats" below.
   */
  it('counts exactly what the matching listing lists', async () => {
    const stats = await get<Stats>('/api/stats')

    const [projects, members, events] = await Promise.all([
      get<Project[]>('/api/projects?limit=100'),
      // `status=all`, not the default. CURRENT excludes officer alumni now, and
      // an officer alumnus who still pays dues counts towards the stat — so the
      // default listing is not guaranteed to be the larger of the two and this
      // assertion would be measuring the wrong pair.
      get<Member[]>('/api/members?status=all&limit=1000'),
      get<unknown[]>('/api/events?limit=100'),
    ])

    expect(projects).toHaveLength(stats.projects)
    expect(events).toHaveLength(stats.events)
    expect(members.length).toBeGreaterThanOrEqual(stats.members)
  })
})

describe('GET /api/projects', () => {
  it('exposes the fields the landing page renders', async () => {
    const projects = await get<Record<string, unknown>[]>('/api/projects?limit=5')
    expect(Array.isArray(projects)).toBe(true)

    for (const project of projects) {
      // `competition` may be null, but the key has to be there or the frontend
      // type is lying.
      for (const field of ['slug', 'title', 'summary', 'season', 'competition']) {
        expect(project, `project ${project.slug}`).toHaveProperty(field)
      }
    }
  })

  it('honours the limit the landing page asks for', async () => {
    const projects = await get<Project[]>('/api/projects?limit=2')
    expect(projects.length).toBeLessThanOrEqual(2)
  })

  it('404s an unknown slug instead of 500ing', async () => {
    const response = await app.request('/api/projects/no-such-project')
    expect(response.status).toBe(404)
  })

  /**
   * The gallery and the resource links are the detail route's by default. The
   * listing answers up to a hundred rows, so a `select` that grew them there
   * unconditionally would ship every project's whole gallery to anyone opening
   * `/projects` — which is exactly the kind of change that looks harmless in a
   * diff. `images=true` is the one way past it, tested below.
   */
  it('carries the gallery and links on the detail route and not on the list', async () => {
    const [first] = await get<Project[]>('/api/projects?limit=1')
    if (!first) return

    const detail = await get<ProjectDetail>(`/api/projects/${first.slug}`)
    expect(Array.isArray(detail.images)).toBe(true)
    expect(Array.isArray(detail.links)).toBe(true)

    const listed = await get<Record<string, unknown>[]>('/api/projects?limit=100')
    for (const project of listed) {
      expect(project, `project ${project.slug}`).not.toHaveProperty('images')
      expect(project, `project ${project.slug}`).not.toHaveProperty('links')
    }
  })

  /**
   * The array order *is* the display order, which is why neither list carries a
   * sort key. Sending one as well would give the client a second opinion to
   * disagree with. The framing, by contrast, has to be on the wire: the public
   * page is what draws these, and without it every gallery reverts to a plain
   * centred crop for exactly the visitors it was framed for.
   */
  it('carries the framing but not the sort key', async () => {
    const [first] = await get<Project[]>('/api/projects?limit=1')
    if (!first) return

    const detail = await get<ProjectDetail>(`/api/projects/${first.slug}`)
    for (const image of detail.images) {
      expect(Object.keys(image).sort()).toEqual([
        'caption',
        'focalX',
        'focalY',
        'id',
        'url',
        'zoom',
      ])
    }
    for (const link of detail.links) {
      expect(Object.keys(link).sort()).toEqual(['id', 'label', 'url'])
    }
  })

  /**
   * The two heavy columns are independent flags, and asking for one must not
   * drag in the other: `/projects` wants pictures and writing for the current
   * term but only the writing for the archive, which is forty-odd rows.
   */
  it('carries the gallery when the list asks for it, and nothing else', async () => {
    const listed = await get<Record<string, unknown>[]>(
      '/api/projects?images=true&limit=100',
    )

    for (const project of listed) {
      expect(project, `project ${project.slug}`).toHaveProperty('images')
      expect(Array.isArray(project.images), `project ${project.slug}`).toBe(true)
      expect(project, `project ${project.slug}`).not.toHaveProperty('description')
      expect(project, `project ${project.slug}`).not.toHaveProperty('links')
      expect(project, `project ${project.slug}`).not.toHaveProperty('members')
    }
  })

  /**
   * The write-up is what `/projects` actually prints. `summary` is the column
   * the schema calls the one-liner for cards and **no project the club has
   * created has one** — a list that read only `summary` was a list of titles
   * over empty paragraphs, which is what this flag exists to fix.
   */
  it('carries the write-up when the list asks for it, and no pictures with it', async () => {
    const listed = await get<Record<string, unknown>[]>(
      '/api/projects?description=true&limit=100',
    )

    for (const project of listed) {
      expect(project, `project ${project.slug}`).toHaveProperty('description')
      expect(project, `project ${project.slug}`).not.toHaveProperty('images')
    }
  })

  /**
   * The public list is one term with the rest behind a button, and the two
   * halves have to cover the whole table between them — a project on neither
   * is a project on no page at all, which is why `other` is the negation of
   * `current` rather than "everything before it".
   */
  it('splits the whole list between term=current and term=other', async () => {
    // Sequential rather than in parallel: both term filters resolve the
    // current term off the academic calendar, and asking three times at once
    // is three cold reads of it that need not agree.
    const all = await get<Term[]>('/api/projects?limit=100')
    const current = await get<Term[]>('/api/projects?term=current&limit=100')
    const other = await get<Term[]>('/api/projects?term=other&limit=100')

    const slugs = (rows: Term[]) => rows.map((row) => row.slug).sort()
    expect(slugs([...current, ...other])).toEqual(slugs(all))
    // Disjoint, not merely covering.
    expect(current.filter((row) => other.some((old) => old.slug === row.slug)))
      .toEqual([])
  })

  /** One term in `current`, and it is the same one for every row in it. */
  it('answers term=current with a single term', async () => {
    const current = await get<Term[]>('/api/projects?term=current&limit=100')
    const terms = new Set(
      current.map((row) => `${String(row.termYear)}-${row.termSeason}`),
    )
    expect(terms.size).toBeLessThanOrEqual(1)
  })

  /**
   * The archive is read downwards by term, so it is ordered by term — not by
   * `featured`, which is landing-page curation, and not by `startedAt`, which
   * no route here writes.
   */
  it('orders term=other newest term first', async () => {
    const other = await get<Term[]>('/api/projects?term=other&limit=100')
    const rank = (row: Term) =>
      row.termYear * 10 + ['SPRING', 'SUMMER', 'FALL'].indexOf(row.termSeason)

    for (const [index, row] of other.entries()) {
      if (index === 0) continue
      expect(rank(other[index - 1]!), `row ${String(index)}`).toBeGreaterThanOrEqual(
        rank(row),
      )
    }
  })
})

/** The board answers `{ seats, officers }` — how many chairs there are, and who
    is sitting. Both are the database's answer; neither is a frontend list. */
type Board = { seats: string[]; officers: OfficerTerm[] }

describe('GET /api/officers', () => {
  /**
   * **The size of the board comes from the enum.** It was a constant in
   * `web/src/content/home.ts`, so the club could not change the shape of its
   * own board without a frontend edit. Adding a value to `OfficerPosition` has
   * to reach the page on its own.
   */
  it('sends the seats there are, in the order the enum declares them', async () => {
    const board = await get<Board>('/api/officers')

    expect(board.seats.length).toBeGreaterThan(0)
    // President first: the enum is declared in board order and this route reads
    // it straight, so a reordering of the schema reorders the page.
    expect(board.seats[0]).toBe('PRESIDENT')
    expect(new Set(board.seats).size).toBe(board.seats.length)
  })

  /**
   * A seat holds one person. There is no unique index enforcing it — a partial
   * one over open terms is not something Prisma can express, so the seat route
   * checks instead — which makes this the tripwire on that check rather than on
   * a constraint.
   */
  it('returns at most one person per seat', async () => {
    const { officers } = await get<Board>('/api/officers')

    const seats = officers.flatMap((term) => (term.position ? [term.position] : []))
    expect(new Set(seats).size).toBe(seats.length)
  })

  /**
   * Open terms only, and that is the definition of the board. A closed one
   * appearing here would put somebody who left back in a chair.
   */
  it('answers with open terms and nothing else', async () => {
    const { officers } = await get<Board>('/api/officers')

    expect(officers.length).toBeGreaterThan(0)
    for (const term of officers) {
      expect(term.endedAt).toBeNull()
      expect(Date.parse(term.startedAt)).not.toBeNaN()
    }
  })

  /**
   * **An officer holding no named seat is on the board.** The Discord sync
   * promotes somebody the moment they carry the role and gives them no chair —
   * an officer does that, later — so a route that dropped them would make a
   * real officer invisible on the front page while they were an officer
   * everywhere else on the site.
   */
  it('keeps an officer who holds no seat', async () => {
    const seatless = await prisma.officerTerm.findFirst({
      where: { endedAt: null, position: null },
      select: { id: true },
    })
    if (!seatless) return

    const { officers } = await get<Board>('/api/officers')
    expect(officers.some((term) => term.id === seatless.id)).toBe(true)
  })

  /**
   * The seat and the permission level are different axes, which is the reason
   * this route exists rather than reusing `/members?role=OFFICER` — the faculty
   * advisor sits on the board as a plain `MEMBER`, and an admin can sit on it
   * without `UserRole` being able to say so at all.
   */
  it('is not the same set as the officers by role', async () => {
    const [board, byRole] = await Promise.all([
      get<Board>('/api/officers').then((b) => b.officers),
      get<Member[]>('/api/members?role=OFFICER&limit=100'),
    ])

    expect(board.length).toBeGreaterThan(0)
    expect(byRole.every((member) => member.role === 'OFFICER')).toBe(true)

    // The board is read from a different table, so it can hold somebody the
    // role filter does not. If these ever match exactly, the two have converged.
    const seated = new Set(board.map((term) => term.fullName))
    const byRoleNames = new Set(byRole.map((member) => member.fullName))
    expect([...seated].some((name) => !byRoleNames.has(name))).toBe(true)
  })

  it('never returns an email or a password hash', async () => {
    const { officers } = await get<Board>('/api/officers')
    for (const term of officers) {
      expect(term).not.toHaveProperty('email')
      expect(term).not.toHaveProperty('passwordHash')
      expect(term).not.toHaveProperty('user')
      expect(term).not.toHaveProperty('userId')
    }
  })
})

/** The archive answers `{ terms, older }` — a window, not the whole table. */
type Archive = { terms: OfficerTerm[]; older: number }

describe('GET /api/officers/past', () => {
  /**
   * The archive's own fixture, because the archive can legitimately be empty.
   *
   * It was not, once: the seed invented fifteen past terms and every assertion
   * here leaned on them. The club's real database has no officer history in it
   * at all — the old site recorded who held a seat *now* and never who had —
   * so after the import there is a full board and an empty archive, and the
   * shape assertions below had nothing to run against.
   *
   * Making the test conditional would have been the smaller change and the
   * wrong one: a case that skips itself when the table is empty stops checking
   * the thing it is named after. So it brings its own closed term.
   */
  const ARCHIVED = 'test-content-archive-officer'

  beforeEach(async () => {
    await prisma.officerTerm.deleteMany({ where: { fullName: ARCHIVED } })
    await prisma.officerTerm.create({
      data: {
        fullName: ARCHIVED,
        position: 'PRESIDENT',
        // Long enough ago to be outside the two-year default window, so the
        // `older` count above has something to count and the windowing cases
        // are not quietly asserting against zero.
        startedAt: new Date('2019-08-01T00:00:00Z'),
        endedAt: new Date('2020-05-31T00:00:00Z'),
        source: 'MANUAL',
      },
    })
  })

  afterAll(async () => {
    await prisma.officerTerm.deleteMany({ where: { fullName: ARCHIVED } })
  })

  /**
   * Two academic years by default, and the *rest is still reachable*. A window
   * that could not be widened would make the archive a claim the site does not
   * keep, and `older` is what tells the page there is more.
   */
  it('windows to the two most recent years, and says how much is outside', async () => {
    const [windowed, everything] = await Promise.all([
      get<Archive>('/api/officers/past'),
      get<Archive>('/api/officers/past?all=1'),
    ])

    expect(everything.older).toBe(0)
    expect(windowed.terms.length).toBeLessThanOrEqual(everything.terms.length)
    expect(windowed.terms.length + windowed.older).toBe(everything.terms.length)

    // At most two distinct academic years in the default window.
    const years = new Set(windowed.terms.map((term) => academicYearOf(term.startedAt)))
    expect(years.size).toBeLessThanOrEqual(2)
  })

  /**
   * **The window counts years that exist, not years off the clock.** A club that
   * has not rotated since 2025 would get an empty page from a window measured
   * against today, which is the one thing a default must never do.
   */
  it('never comes back empty while the archive has anything in it', async () => {
    const everything = await get<Archive>('/api/officers/past?all=1')
    if (everything.terms.length === 0) return

    const windowed = await get<Archive>('/api/officers/past')
    expect(windowed.terms.length).toBeGreaterThan(0)
  })

  it('narrows further when asked for one year', async () => {
    const one = await get<Archive>('/api/officers/past?years=1')
    const years = new Set(one.terms.map((term) => academicYearOf(term.startedAt)))

    expect(years.size).toBeLessThanOrEqual(1)
  })
  /**
   * The seat order the board is drawn in is the enum's declaration order, and
   * Postgres sorts an enum by exactly that — which is the whole reason neither
   * this route nor the page carries a lookup table of ranks. Asserted against
   * `/api/officers`, because that route leans on the same property and the two
   * must not be able to disagree about what board order is.
   */
  it('comes back newest first, in board order inside a start date', async () => {
    const [archive, board] = await Promise.all([
      get<Archive>('/api/officers/past?all=1').then((a) => a.terms),
      get<Board>('/api/officers').then((b) => b.officers),
    ])

    // The seat ranking is read off the board rather than written down here,
    // because it is the enum's declaration order and Postgres sorts on that —
    // which is the whole reason neither route carries a lookup table.
    const rank = new Map(board.map((term, index) => [term.position, index]))

    for (const [index, term] of archive.entries()) {
      const previous = archive[index - 1]
      if (!previous) continue

      const a = Date.parse(previous.startedAt)
      const b = Date.parse(term.startedAt)
      if (a !== b) {
        expect(a).toBeGreaterThan(b)
        continue
      }

      // Same start, different end: the longer term sorts first. This is the
      // advisor who held a seat across four years landing above the president
      // who held one for two from the same August.
      const endA = Date.parse(previous.endedAt ?? '')
      const endB = Date.parse(term.endedAt ?? '')
      if (endA !== endB) {
        expect(endA).toBeGreaterThan(endB)
        continue
      }

      // Same span: board order, skipped when the board does not currently hold
      // both seats.
      const seatA = rank.get(previous.position)
      const seatB = rank.get(term.position)
      if (seatA !== undefined && seatB !== undefined) {
        expect(seatA).toBeLessThanOrEqual(seatB)
      }
    }
  })

  /**
   * The archive is a different table from the board, not a filter on it. If
   * this ever comes back as roster entries, `officerPosition` is being read as
   * history again — which it cannot be, because it is unique.
   */
  it('answers with terms rather than with people', async () => {
    const { terms: archive } = await get<Archive>('/api/officers/past?all=1')

    expect(archive.length).toBeGreaterThan(0)
    for (const term of archive) {
      expect(Object.keys(term).sort()).toEqual([
        'endedAt',
        'fullName',
        'id',
        'photoUrl',
        'position',
        'profileUrl',
        'startedAt',
      ])
      // A term nobody held, one still open, or one that ended before it began
      // is a row that got in past the page rather than through it.
      expect(term.fullName.trim().length).toBeGreaterThan(0)
      expect(term.endedAt).not.toBeNull()
      expect(Date.parse(term.endedAt ?? '')).toBeGreaterThanOrEqual(
        Date.parse(term.startedAt),
      )
    }
  })

  it('never returns an email or a password hash', async () => {
    const { terms } = await get<Archive>('/api/officers/past?all=1')
    for (const term of terms) {
      expect(term).not.toHaveProperty('email')
      expect(term).not.toHaveProperty('passwordHash')
      // The linked roster entry is read for a headshot and a profile link, and
      // for nothing else.
      expect(term).not.toHaveProperty('user')
      expect(term).not.toHaveProperty('userId')
    }
  })

  /**
   * The route settles which of the two photos answered so the browser never has
   * to, **and the account's is the one that wins**. A photograph filed against
   * one term is a copy nothing keeps up to date; the account's is the picture
   * its owner can change. The term's own is the fallback, which is what still
   * answers for the archive rows with nobody behind them.
   */
  it('prefers the linked account photo over the one stored on the term', async () => {
    const linked = await prisma.officerTerm.findFirst({
      where: { endedAt: { not: null }, user: { photoUrl: { not: null } } },
      select: { id: true, user: { select: { photoUrl: true } } },
    })

    // Nothing to prove if no seeded officer has a photo — none do until real
    // headshots go in, and a test that demanded one would fail on a fresh clone.
    if (!linked) return

    const { terms: archive } = await get<Archive>('/api/officers/past?all=1')
    const term = archive.find((row) => row.id === linked.id)

    expect(term?.photoUrl).toBe(linked.user?.photoUrl)
  })

  /** A term with no account behind it keeps whatever headshot the row carries,
      which is most of the archive and the whole reason the column survives. */
  it('keeps the term headshot where no account is linked', async () => {
    const unlinked = await prisma.officerTerm.findFirst({
      where: { endedAt: { not: null }, userId: null, photoUrl: { not: null } },
      select: { id: true, photoUrl: true },
    })

    if (!unlinked) return

    const { terms: archive } = await get<Archive>('/api/officers/past?all=1')
    const term = archive.find((row) => row.id === unlinked.id)

    expect(term?.photoUrl).toBe(unlinked.photoUrl)
    // Nowhere for it to come from: a link belongs to an account, and a term
    // with no account behind it has none. Never the term's own column — there
    // is no such column and there should not be one, because a link is a live
    // address rather than a record of a year.
    expect(term?.profileUrl).toBeNull()
  })
})

describe('GET /api/events date range', () => {
  /**
   * The calendar asks for one month at a time and expects every event that
   * *touches* it, not only the ones that start inside it — otherwise a
   * multi-day competition disappears from the month it finishes in.
   */
  it('includes an event that starts before the window but runs into it', async () => {
    const all = await get<Event[]>('/api/events?when=all&limit=100')
    const spanning = all.find(
      (event) => event.endsAt && !sameDay(event.startsAt, event.endsAt),
    )

    // Nothing to prove if the seed holds no multi-day event.
    if (!spanning) return

    // A window opening midway through it: starts before `from`, ends after.
    const from = new Date(spanning.endsAt!)
    const to = new Date(from.getTime() + 24 * 60 * 60 * 1000)

    const inWindow = await get<Event[]>(
      `/api/events?when=all&limit=100&from=${from.toISOString()}&to=${to.toISOString()}`,
    )

    expect(inWindow.map((event) => event.slug)).toContain(spanning.slug)
  })

  it('excludes an event that finishes before the window opens', async () => {
    const soon = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
    const later = new Date(soon.getTime() + 24 * 60 * 60 * 1000)

    const events = await get<Event[]>(
      `/api/events?when=all&limit=100&from=${soon.toISOString()}&to=${later.toISOString()}`,
    )

    // Nothing in the seed reaches a year out.
    expect(events).toHaveLength(0)
  })

  it('rejects a range bound that is not a timestamp', async () => {
    const response = await app.request('/api/events?from=next-tuesday')
    expect(response.status).toBe(400)
  })
})

describe('GET /api/sponsors', () => {
  /**
   * The landing page shows "the top five sponsors" by asking for five rows, so
   * the ordering has to be the server's job — the first five must be the five
   * highest tiers, not five arbitrary ones.
   */
  it('orders by tier, so a limit takes the top of the list', async () => {
    const tiers = ['PROCESSOR_PATRON', 'CIRCUIT_SUPPORTER', 'BOLT_BACKER', 'ALUMINUM_ALLY']

    const all = await get<Sponsor[]>('/api/sponsors?limit=100')
    const ranks = all.map((sponsor) => tiers.indexOf(sponsor.tier))
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))

    const top = await get<Sponsor[]>('/api/sponsors?limit=5')
    expect(top.length).toBeLessThanOrEqual(5)
    expect(top.map((sponsor) => sponsor.name)).toEqual(
      all.slice(0, 5).map((sponsor) => sponsor.name),
    )
  })
})

describe('public routes and private columns', () => {
  /**
   * The one rule in this file worth failing a deploy over. `User` holds logins
   * and roster entries in one table, so every public select is one careless
   * `...user` away from publishing an email address or a password hash.
   */
  it('never returns an email or a password hash from the roster', async () => {
    const members = await get<Member[]>('/api/members?status=all&limit=100')
    expect(members.length).toBeGreaterThan(0)

    for (const member of members) {
      expect(member).not.toHaveProperty('email')
      expect(member).not.toHaveProperty('passwordHash')
    }

    // Same again for a single profile, which selects a wider set of columns.
    // Whoever *has* a slug rather than whoever came first: the listing is the
    // whole club now and most of it has no profile URL at all.
    const withSlug = members.find((member) => member.slug !== null)
    expect(withSlug, 'no member has a slug to fetch a profile with').toBeDefined()

    const profile = await get<Member>(`/api/members/${withSlug!.slug}`)
    expect(profile).not.toHaveProperty('email')
    expect(profile).not.toHaveProperty('passwordHash')
  })

  /**
   * The inverse of the test this replaced, which asserted that accounts without
   * a slug stayed out. That filter is gone — it was the reason the page showed
   * sixty of six hundred and eighty-eight — and it is exactly the sort of thing
   * somebody tidying reinstates. Counting against the table is what catches it.
   */
  it('lists every account, guests and people with no slug included', async () => {
    const members = await get<Member[]>('/api/members?status=all&limit=1000')
    const total = await prisma.user.count()

    expect(members).toHaveLength(Math.min(total, 1000))
    expect(members.some((member) => member.slug === null)).toBe(true)
  })

  /**
   * The landing page's cell is the club's membership and the page it links to
   * is every account, so these two numbers are *supposed* to differ. Pinned
   * because the obvious "fix" for that gap is to make one match the other.
   */
  it('counts the active membership in /stats, not the whole listing', async () => {
    const { members } = await get<Stats>('/api/stats')
    const expected = await prisma.user.count({
      where: { active: true, role: { not: 'GUEST' } },
    })

    expect(members).toBe(expected)
  })

  it('hides unpublished events', async () => {
    const events = await get<unknown[]>('/api/events?when=all&limit=100')
    const published = await prisma.event.count({ where: { published: true } })

    expect(events).toHaveLength(published)
  })
})

/**
 * Project meetings on the *public* calendar.
 *
 * This is the one place the site's "the front page is officer-curated" rule
 * bends, so the gate on it is worth pinning from the outside: `meetingsPublic`
 * decides, one project at a time, and it is an officer's switch. Everything
 * else about the public calendar is unchanged — the unpublished-event invariant
 * a few tests up still holds, and these rows are not events at all.
 *
 * UCF's calendar is stubbed rather than reached. Fixtures sit in 2035, which
 * the real feed has never heard of, so without a stub this would depend on a
 * 404 falling back to the right guessed dates.
 */
describe('GET /api/events with project meetings', () => {
  const PREFIX = 'test-content-meetings-'

  /** A window inside the stubbed term, one month wide. */
  const WINDOW =
    'when=all&limit=100&from=2035-09-01T00:00:00.000Z&to=2035-10-01T00:00:00.000Z'

  const feed = {
    terms: [
      {
        events: [
          {
            summary: 'Classes Begin',
            dtstart: '2035-08-27T08:00:00',
            eventSession: '1',
          },
          {
            summary: 'Classes End',
            dtstart: '2035-12-05T08:00:00',
            eventSession: '1',
          },
          {
            summary: 'On-Campus Housing Closes',
            dtstart: '2035-12-12T09:00:00',
            eventSession: '1',
          },
        ],
      },
    ],
  }

  const makeProject = (slug: string, meetingsPublic: boolean) =>
    prisma.project.create({
      data: {
        slug: `${PREFIX}${slug}`,
        title: `Content ${slug}`,
        termYear: 2035,
        termSeason: Season.FALL,
        meetingWeekdays: [2, 4],
        meetingStartTime: '18:00',
        meetingEndTime: '22:00',
        meetingLocation: 'ENG2 Lab',
        meetingsPublic,
      },
    })

  const titlesIn = (events: { title: string }[]) =>
    events.map((event) => event.title)

  beforeEach(async () => {
    await prisma.project.deleteMany({ where: { slug: { startsWith: PREFIX } } })
    clearCalendarCache()

    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(feed), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    )
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    clearCalendarCache()
    await prisma.project.deleteMany({ where: { slug: { startsWith: PREFIX } } })
  })

  it('carries the meetings of a project that is on the public calendar', async () => {
    await makeProject('shown', true)

    const events = await get<{ title: string; id: string }[]>(
      `/api/events?${WINDOW}`,
    )

    const mine = events.filter((event) => event.title === 'Content shown meeting')
    expect(mine.length).toBeGreaterThan(0)
    // Generated, not stored — nothing downstream may offer to edit one.
    expect(mine.every((event) => event.id.startsWith('meeting:'))).toBe(true)
  })

  it('leaves out a project switched off the public calendar', async () => {
    await makeProject('hidden', false)

    const events = await get<{ title: string }[]>(`/api/events?${WINDOW}`)

    expect(titlesIn(events)).not.toContain('Content hidden meeting')
  })

  /**
   * A recurrence has no answer to "the next 50 events", so meetings are only
   * expanded for a window with both ends named. Every caller that wants them is
   * a calendar and every calendar asks for a month; `?when=upcoming` keeps
   * meaning exactly what it meant, which is what keeps `limit`, `offset` and
   * `GET /stats` honest.
   */
  it('expands nothing without both ends of a window', async () => {
    await makeProject('unwindowed', true)

    const events = await get<{ title: string }[]>('/api/events?when=all&limit=100')

    expect(titlesIn(events)).not.toContain('Content unwindowed meeting')
  })

  it('leaves them out when the caller asked for another type', async () => {
    await makeProject('typed', true)

    const events = await get<{ title: string }[]>(
      `/api/events?${WINDOW}&type=COMPETITION`,
    )

    expect(titlesIn(events)).not.toContain('Content typed meeting')
  })
})

/**
 * The roster's three chips, and what ALUMNI means since it stopped meaning
 * `active: false`.
 *
 * It is the club's Discord **Officer Alumni** role, mirrored into
 * `User.officerAlumnus` by `discord/discordAlumni.ts`. The fixtures make the
 * two facts different people on purpose, because reading `active` for this is
 * the mistake the column exists to prevent — `membershipUpdateFor` sets
 * `active` back to true on every payment, so it can never mean "used to run the
 * club", and somebody can be both.
 *
 * No Discord anywhere near this: the sweep writes the column and these tests
 * write it directly, which is the boundary worth testing on this side.
 */
describe('GET /api/members and the alumni chip', () => {
  const PREFIX = 'test-content-roster-'
  const email = (name: string) => `${PREFIX}${name}@ucf.edu`

  const make = (
    name: string,
    extra: { active?: boolean; officerAlumnus?: boolean } = {},
  ) =>
    prisma.user.create({
      data: { fullName: `Roster ${name}`, email: email(name), ...extra },
      select: { id: true },
    })

  const clearRows = () =>
    prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })

  beforeEach(clearRows)
  afterAll(clearRows)

  const named = (rows: Member[], name: string) =>
    rows.some((row) => row.fullName === `Roster ${name}`)

  it('files officer alumni under alumni and nobody else', async () => {
    await make('past', { officerAlumnus: true })
    await make('retired', { active: false })
    await make('current')

    const alumni = await get<Member[]>('/api/members?status=alumni&limit=1000')

    expect(named(alumni, 'past')).toBe(true)
    // The whole point of the column: a retired account is not an officer
    // alumnus, and this is the pair that used to be one boolean.
    expect(named(alumni, 'retired')).toBe(false)
    expect(named(alumni, 'current')).toBe(false)
    expect(alumni.every((row) => row.officerAlumnus)).toBe(true)
  })

  it('keeps officer alumni out of the current list', async () => {
    await make('past', { officerAlumnus: true })
    await make('current')

    const current = await get<Member[]>('/api/members?status=active&limit=1000')

    expect(named(current, 'current')).toBe(true)
    expect(named(current, 'past')).toBe(false)
  })

  /**
   * Somebody can hold the Discord role *and* be a paid-up member — one of the
   * twenty-seven people carrying it in the club's guild is also a sitting
   * officer — so the chip has to sort them somewhere and it sorts them here.
   */
  it('files a current member who is also an officer alumnus under alumni', async () => {
    await make('both', { officerAlumnus: true, active: true })

    const alumni = await get<Member[]>('/api/members?status=alumni&limit=1000')
    const current = await get<Member[]>('/api/members?status=active&limit=1000')

    expect(named(alumni, 'both')).toBe(true)
    expect(named(current, 'both')).toBe(false)
  })

  it('shows all three under everyone', async () => {
    await make('past', { officerAlumnus: true })
    await make('retired', { active: false })
    await make('current')

    const all = await get<Member[]>('/api/members?status=all&limit=1000')

    for (const name of ['past', 'retired', 'current']) {
      expect(named(all, name), name).toBe(true)
    }
  })
})
