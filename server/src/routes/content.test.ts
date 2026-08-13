import { afterAll, describe, expect, it } from 'vitest'
import { app } from '../app.js'
import { prisma } from '../db.js'

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
type Member = { slug: string; role: string; officerPosition: string | null }
type Project = { slug: string }
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
   * The contract the landing page is built on: every stat cell links to a
   * listing, and the number on the cell is how many rows that listing has. If
   * a filter is ever added to one side and not the other, this is what catches
   * it. `limit` is pushed past the defaults so a large table can't make a
   * genuine disagreement look like pagination.
   */
  it('counts exactly what the matching listing lists', async () => {
    const stats = await get<Stats>('/api/stats')

    const [projects, members, events] = await Promise.all([
      get<Project[]>('/api/projects?limit=100'),
      get<Member[]>('/api/members?limit=100'),
      get<unknown[]>('/api/events?limit=100'),
    ])

    expect(projects).toHaveLength(stats.projects)
    expect(members).toHaveLength(stats.members)
    expect(events).toHaveLength(stats.events)
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
   * The gallery and the resource links belong to the detail route alone. The
   * listing answers up to a hundred rows, so a `select` that grew them there
   * would ship every project's whole gallery to anyone opening `/projects` —
   * which is exactly the kind of change that looks harmless in a diff.
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
})

describe('GET /api/officers', () => {
  /**
   * The board is drawn one card per seat, and a seat holds one person. The
   * unique constraint on `officer_position` is what enforces that; this is the
   * assertion that notices if it is ever dropped.
   */
  it('returns at most one person per seat', async () => {
    const officers = await get<Member[]>('/api/officers')

    const seats = officers.map((officer) => officer.officerPosition)
    expect(seats.every(Boolean), 'every officer holds a seat').toBe(true)
    expect(new Set(seats).size).toBe(seats.length)
  })

  /**
   * The seat and the permission level are different axes — the faculty advisor
   * sits on the board as a MENTOR. A `role=OFFICER` filter would drop them,
   * which is the reason this route exists rather than reusing /members.
   */
  it('is not the same set as the officers by role', async () => {
    const [board, byRole] = await Promise.all([
      get<Member[]>('/api/officers'),
      get<Member[]>('/api/members?role=OFFICER&limit=100'),
    ])

    const roles = new Set(board.map((officer) => officer.role))
    expect(board.length).toBeGreaterThan(0)
    // If this ever collapses to a single role, the two routes have converged
    // and the extra field is no longer earning its place.
    expect(roles.size).toBeGreaterThan(1)
    expect(byRole.every((member) => member.role === 'OFFICER')).toBe(true)
  })

  it('never returns an email or a password hash', async () => {
    for (const officer of await get<Member[]>('/api/officers')) {
      expect(officer).not.toHaveProperty('email')
      expect(officer).not.toHaveProperty('passwordHash')
    }
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
    const [first] = members
    const profile = await get<Member>(`/api/members/${first!.slug}`)
    expect(profile).not.toHaveProperty('email')
    expect(profile).not.toHaveProperty('passwordHash')
  })

  it('leaves accounts that are not roster entries out of the listing', async () => {
    const members = await get<Member[]>('/api/members?status=all&limit=100')

    // The seed creates an admin and a prospective member, both without a slug,
    // and a GUEST is someone who has signed up and nothing more.
    for (const member of members) {
      expect(member.slug).toBeTruthy()
      expect(member.role).not.toBe('GUEST')
    }
  })

  it('hides unpublished events', async () => {
    const events = await get<unknown[]>('/api/events?when=all&limit=100')
    const published = await prisma.event.count({ where: { published: true } })

    expect(events).toHaveLength(published)
  })
})
