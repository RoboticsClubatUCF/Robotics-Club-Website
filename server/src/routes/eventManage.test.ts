import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../app.js'
import { prisma } from '../db.js'
import { env } from '../env.js'
import {
  ProjectMemberRank,
  UserRole,
} from '../generated/prisma/enums.js'
import { createSession } from '../session.js'

/**
 * The event permission matrix, and the visibility rule it protects.
 *
 * Two properties carry the suite. The matrix itself: a team lead schedules for
 * their own team, the project lead can overrule any of their teams' leads, an
 * officer can overrule anybody — asymmetries the user asked for by name. And
 * the invariant that makes lead-created events safe at all: **nothing a lead
 * creates ever reaches the public `/api/events`**, because `published` stays
 * false unless an officer says otherwise.
 */

const PREFIX = 'test-events-'
const email = (name: string) => `${PREFIX}${name}@ucf.edu`

const clearWindows = () =>
  prisma.rateLimit.deleteMany({ where: { key: { startsWith: 'events:' } } })

const clearRows = async () => {
  await prisma.project.deleteMany({ where: { slug: { startsWith: PREFIX } } })
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
}

async function cookieFor(userId: string): Promise<string> {
  const { token } = await createSession(userId)
  return `${env.SESSION_COOKIE_NAME}=${token}`
}

let cookies: Record<
  'officer' | 'lead' | 'teamLead' | 'siblingLead' | 'member' | 'outsider',
  string
>
let projectId: string
let teamId: string
let siblingTeamId: string
let teamLeadId: string

beforeEach(async () => {
  await clearWindows()
  await clearRows()

  const [officer, lead, teamLead, siblingLead, member, outsider] =
    await Promise.all(
      (
        [
          ['officer', UserRole.OFFICER],
          ['lead', UserRole.MEMBER],
          ['teamLead', UserRole.MEMBER],
          ['siblingLead', UserRole.MEMBER],
          ['member', UserRole.MEMBER],
          ['outsider', UserRole.MEMBER],
        ] as const
      ).map(([name, role]) =>
        prisma.user.create({
          data: { fullName: `Events ${name}`, email: email(name), role },
        }),
      ),
    )
  teamLeadId = teamLead.id

  const project = await prisma.project.create({
    data: {
      slug: `${PREFIX}rover`,
      title: 'Events Rover',
      teams: { create: [{ name: 'Alpha' }, { name: 'Beta' }] },
    },
    include: { teams: true },
  })
  projectId = project.id
  teamId = project.teams.find((t) => t.name === 'Alpha')!.id
  siblingTeamId = project.teams.find((t) => t.name === 'Beta')!.id

  await prisma.projectMember.createMany({
    data: [
      { projectId, userId: lead.id, rank: ProjectMemberRank.PROJECT_LEAD },
      { projectId, userId: teamLead.id, rank: ProjectMemberRank.TEAM_LEAD, teamId },
      { projectId, userId: siblingLead.id, rank: ProjectMemberRank.TEAM_LEAD, teamId: siblingTeamId },
      { projectId, userId: member.id },
    ],
  })

  cookies = {
    officer: await cookieFor(officer.id),
    lead: await cookieFor(lead.id),
    teamLead: await cookieFor(teamLead.id),
    siblingLead: await cookieFor(siblingLead.id),
    member: await cookieFor(member.id),
    outsider: await cookieFor(outsider.id),
  }
})

afterAll(async () => {
  await clearWindows()
  await clearRows()
  await prisma.$disconnect()
})

const request = (method: string, path: string, cookie: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      cookie,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const eventBody = (over: Record<string, unknown> = {}) => ({
  title: 'Weekly build night',
  startsAt: '2035-10-18T23:00:00.000Z',
  projectId,
  teamId,
  ...over,
})

/** An event as the team lead would have made it, without the round trip. */
const teamEvent = () =>
  prisma.event.create({
    data: {
      slug: `${PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Seeded team event',
      startsAt: new Date(2035, 9, 18, 18, 0),
      projectId,
      teamId,
      createdById: teamLeadId,
    },
  })

describe('creating events', () => {
  it.each([
    ['its own team lead', 'teamLead', 201],
    ['the project lead', 'lead', 201],
    ['an officer', 'officer', 201],
    ["a sibling team's lead", 'siblingLead', 403],
    ['a plain member', 'member', 403],
    ['somebody on no project', 'outsider', 403],
  ] as const)('a team event by %s -> %i', async (_who, person, status) => {
    const response = await request('POST', '/api/events', cookies[person], eventBody())
    expect(response.status).toBe(status)
  })

  it('a project-wide event needs the project lead, not a team lead', async () => {
    const body = eventBody({ teamId: undefined })

    expect((await request('POST', '/api/events', cookies.teamLead, body)).status).toBe(403)
    expect((await request('POST', '/api/events', cookies.lead, body)).status).toBe(201)
  })

  it('pins the creator, and never publishes for a lead', async () => {
    const response = await request('POST', '/api/events', cookies.teamLead, eventBody())
    const event = (await response.json()) as Record<string, unknown>

    expect(event.published).toBe(false)
    expect(event.createdById).toBeTruthy()
  })

  it('refuses a lead who asks to publish, in words about officers', async () => {
    const response = await request(
      'POST',
      '/api/events',
      cookies.lead,
      eventBody({ teamId: undefined, published: true }),
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('officer'),
    })
  })

  it('lets an officer publish', async () => {
    const response = await request(
      'POST',
      '/api/events',
      cookies.officer,
      eventBody({ published: true }),
    )

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ published: true })
  })

  it('refuses an event that ends before it starts', async () => {
    const response = await request(
      'POST',
      '/api/events',
      cookies.teamLead,
      eventBody({ endsAt: '2035-10-18T22:00:00.000Z' }),
    )

    expect(response.status).toBe(400)
  })

  it("refuses a team that is not the project's", async () => {
    const foreign = await prisma.project.create({
      data: {
        slug: `${PREFIX}other`,
        title: 'Other',
        teams: { create: { name: 'Gamma' } },
      },
      include: { teams: true },
    })

    const response = await request(
      'POST',
      '/api/events',
      cookies.officer,
      eventBody({ teamId: foreign.teams[0]!.id }),
    )

    expect(response.status).toBe(400)
  })
})

describe('editing and deleting', () => {
  it.each([
    ['its creator', 'teamLead', 200],
    ['the project lead', 'lead', 200],
    ['an officer', 'officer', 200],
    ["a sibling team's lead", 'siblingLead', 403],
    ['a plain member', 'member', 403],
  ] as const)("a team lead's event, edited by %s -> %i", async (_who, person, status) => {
    const event = await teamEvent()

    const response = await request(
      'PATCH',
      `/api/events/${event.id}`,
      cookies[person],
      { title: 'Moved to Thursday' },
    )

    expect(response.status).toBe(status)
  })

  it("the project lead can delete a team lead's event — the asymmetry the rank exists for", async () => {
    const event = await teamEvent()

    const response = await request('DELETE', `/api/events/${event.id}`, cookies.lead)

    expect(response.status).toBe(200)
    expect(await prisma.event.findUnique({ where: { id: event.id } })).toBeNull()
  })

  it('a lead cannot flip published on their own event afterwards', async () => {
    const event = await teamEvent()

    const response = await request(
      'PATCH',
      `/api/events/${event.id}`,
      cookies.teamLead,
      { published: true },
    )

    expect(response.status).toBe(403)
  })
})

describe('who sees what', () => {
  it('members see their project events on /api/me/events; outsiders never do', async () => {
    const event = await teamEvent()
    const window = 'from=2035-10-01T00:00:00.000Z&to=2035-11-01T00:00:00.000Z'

    const mine = await request('GET', `/api/me/events?${window}`, cookies.member)
    const mineIds = ((await mine.json()) as { id: string }[]).map((e) => e.id)
    expect(mineIds).toContain(event.id)

    const theirs = await request('GET', `/api/me/events?${window}`, cookies.outsider)
    const theirIds = ((await theirs.json()) as { id: string }[]).map((e) => e.id)
    expect(theirIds).not.toContain(event.id)

    const officers = await request('GET', `/api/me/events?${window}`, cookies.officer)
    const officerIds = ((await officers.json()) as { id: string }[]).map((e) => e.id)
    expect(officerIds).toContain(event.id)
  })

  /**
   * The invariant that makes the rest safe: whatever leads create, the public
   * calendar shows only what officers published. This queries the public
   * route the site actually serves, not the model.
   */
  it('the public /api/events never returns an unpublished event', async () => {
    const event = await teamEvent()

    const response = await app.request(
      '/api/events?when=all&limit=100&from=2035-10-01T00:00:00.000Z&to=2035-11-01T00:00:00.000Z',
    )
    const ids = ((await response.json()) as { id: string }[]).map((e) => e.id)

    expect(ids).not.toContain(event.id)
  })
})
