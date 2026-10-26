import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.js'
import { createSession } from '../../auth/session.js'
import { prisma } from '../../core/db.js'
import { env } from '../../core/env.js'
import { ProjectMemberRank, Season, UserRole } from '../../generated/prisma/enums.js'

/**
 * A project's Google Calendars: who may reach them, and that nothing reaches past the project.
 * Only paths that write nothing to real rows are exercised (see `routes/officer/googleCalendar.test.ts`
 * for why); the sync is covered in `calendar/googleCalendar.test.ts`.
 */

const PREFIX = 'test-gcal-project-'
const address = (name: string) =>
  `https://calendar.google.com/calendar/ical/${PREFIX}${name}%40group.calendar.google.com/private-0000/basic.ics`

let cookies: Record<'officer' | 'lead' | 'teamLead' | 'member' | 'outsider', string>
let projectId: string

const clearRows = async () => {
  await prisma.googleCalendar.deleteMany({ where: { icsUrl: { contains: `/${PREFIX}` } } })
  await prisma.project.deleteMany({ where: { slug: { startsWith: PREFIX } } })
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
}
const clearWindows = () =>
  prisma.rateLimit.deleteMany({ where: { key: { startsWith: 'manage:' } } })

beforeEach(async () => {
  await clearWindows()
  await clearRows()

  const make = (name: string, role: UserRole) =>
    prisma.user.create({
      data: {
        fullName: `Calendar ${name}`,
        email: `${PREFIX}${name}@ucf.edu`,
        role,
        duesPaidThrough: new Date('2035-12-31T00:00:00'),
      },
    })
  const [officer, lead, teamLead, member, outsider] = await Promise.all([
    make('officer', UserRole.OFFICER),
    make('lead', UserRole.MEMBER),
    make('teamLead', UserRole.MEMBER),
    make('member', UserRole.MEMBER),
    make('outsider', UserRole.MEMBER),
  ])

  const project = await prisma.project.create({
    data: {
      slug: `${PREFIX}rover`,
      title: 'Calendar Rover',
      termYear: 2035,
      termSeason: Season.FALL,
      teams: { create: [{ name: 'Alpha' }] },
    },
    include: { teams: true },
  })
  projectId = project.id
  await prisma.projectMember.createMany({
    data: [
      { projectId, userId: lead.id, rank: ProjectMemberRank.PROJECT_LEAD },
      {
        projectId,
        userId: teamLead.id,
        rank: ProjectMemberRank.TEAM_LEAD,
        teamId: project.teams[0]!.id,
      },
      { projectId, userId: member.id },
    ],
  })

  const cookieFor = async (id: string) =>
    `${env.SESSION_COOKIE_NAME}=${(await createSession(id)).token}`
  cookies = {
    officer: await cookieFor(officer.id),
    lead: await cookieFor(lead.id),
    teamLead: await cookieFor(teamLead.id),
    member: await cookieFor(member.id),
    outsider: await cookieFor(outsider.id),
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
})

afterAll(async () => {
  await clearWindows()
  await clearRows()
  await prisma.$disconnect()
})

const request = (method: string, path: string, cookie: string, body?: unknown, project = projectId) =>
  app.request(`/api/projects/${project}/google-calendars${path}`, {
    method,
    headers: {
      cookie,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

describe("a project's Google Calendars", () => {
  it.each([
    ['its project lead', 'lead', 200],
    ['an officer', 'officer', 200],
    ['a team lead', 'teamLead', 403],
    ['a plain member', 'member', 403],
    ['somebody on no project', 'outsider', 403],
  ] as const)('are listed for %s -> %i', async (_who, person, status) => {
    expect((await request('GET', '', cookies[person])).status).toBe(status)
  })

  it('answers 404 for a project that is not there', async () => {
    const response = await request(
      'GET',
      '',
      cookies.officer,
      undefined,
      '0198f0f0-0000-7000-8000-000000000000',
    )
    expect(response.status).toBe(404)
  })

  it("lists only the project's own, with whether each is public", async () => {
    await prisma.googleCalendar.createMany({
      data: [
        { icsUrl: address('mine'), name: 'Rover builds', projectId, published: false },
        { icsUrl: address('club'), name: 'Club calendar' },
      ],
    })

    const list = (await (await request('GET', '', cookies.lead)).json()) as Record<string, unknown>[]

    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ name: 'Rover builds', published: false })
    expect(JSON.stringify(list)).not.toContain('private-')
  })

  it("can't reach a club calendar through a project", async () => {
    const club = await prisma.googleCalendar.create({ data: { icsUrl: address('club') } })

    expect(
      (await request('PATCH', `/${club.id}`, cookies.lead, { published: false })).status,
    ).toBe(404)
    expect((await request('DELETE', `/${club.id}`, cookies.lead)).status).toBe(404)
    expect(await prisma.googleCalendar.findUnique({ where: { id: club.id } })).not.toBeNull()
  })

  it('makes a calendar public or not', async () => {
    const calendar = await prisma.googleCalendar.create({
      data: { icsUrl: address('flip'), projectId, published: false },
    })

    const response = await request('PATCH', `/${calendar.id}`, cookies.lead, { published: true })

    expect(response.status).toBe(200)
    expect(
      await prisma.googleCalendar.findUniqueOrThrow({ where: { id: calendar.id } }),
    ).toMatchObject({ published: true })
  })

  it('refuses an address that is not a Google Calendar feed, without fetching it', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const response = await request('POST', '', cookies.lead, {
      url: 'https://example.com/calendar.ics',
      published: false,
    })

    expect(response.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('refuses a calendar the club already imports', async () => {
    await prisma.googleCalendar.create({ data: { icsUrl: address('shared') } })

    const response = await request('POST', '', cookies.lead, { url: address('shared') })

    expect(response.status).toBe(409)
  })
})
