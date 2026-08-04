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
type Member = { slug: string; role: string }
type Project = { slug: string }

const get = async <T>(path: string): Promise<T> => {
  const response = await app.request(path)
  expect(response.status, `GET ${path}`).toBe(200)
  return (await response.json()) as T
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
