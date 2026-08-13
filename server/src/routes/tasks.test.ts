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
 * Tasks, against the live database. The scoping mirrors events — team lead on
 * their own board, project lead everywhere in the project — so what earns its
 * keep here is the part that is looser on purpose: an assignee may tick their
 * own task whatever their rank, and nobody else below lead may touch it.
 */

const PREFIX = 'test-tasks-'
const email = (name: string) => `${PREFIX}${name}@ucf.edu`

const clearWindows = () =>
  prisma.rateLimit.deleteMany({ where: { key: { startsWith: 'tasks:' } } })

const clearRows = async () => {
  await prisma.project.deleteMany({ where: { slug: { startsWith: PREFIX } } })
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
}

async function cookieFor(userId: string): Promise<string> {
  const { token } = await createSession(userId)
  return `${env.SESSION_COOKIE_NAME}=${token}`
}

let cookies: Record<'lead' | 'teamLead' | 'assignee' | 'bystander', string>
let ids: Record<'lead' | 'teamLead' | 'assignee' | 'bystander', string>
let projectId: string
let teamId: string
let otherTeamId: string

beforeEach(async () => {
  await clearWindows()
  await clearRows()

  const [lead, teamLead, assignee, bystander] = await Promise.all(
    (['lead', 'teamLead', 'assignee', 'bystander'] as const).map((name) =>
      prisma.user.create({
        data: {
          fullName: `Tasks ${name}`,
          email: email(name),
          role: UserRole.MEMBER,
        },
      }),
    ),
  )

  const project = await prisma.project.create({
    data: {
      slug: `${PREFIX}rover`,
      title: 'Tasks Rover',
      teams: { create: [{ name: 'Alpha' }, { name: 'Beta' }] },
    },
    include: { teams: true },
  })
  projectId = project.id
  teamId = project.teams.find((t) => t.name === 'Alpha')!.id
  otherTeamId = project.teams.find((t) => t.name === 'Beta')!.id

  await prisma.projectMember.createMany({
    data: [
      { projectId, userId: lead.id, rank: ProjectMemberRank.PROJECT_LEAD },
      { projectId, userId: teamLead.id, rank: ProjectMemberRank.TEAM_LEAD, teamId },
      { projectId, userId: assignee.id, teamId },
      { projectId, userId: bystander.id },
    ],
  })

  ids = { lead: lead.id, teamLead: teamLead.id, assignee: assignee.id, bystander: bystander.id }
  cookies = {
    lead: await cookieFor(lead.id),
    teamLead: await cookieFor(teamLead.id),
    assignee: await cookieFor(assignee.id),
    bystander: await cookieFor(bystander.id),
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

const seedTask = (over: Record<string, unknown> = {}) =>
  prisma.task.create({
    data: {
      projectId,
      teamId,
      title: 'CAD the chassis',
      createdById: ids.teamLead,
      assignees: { create: { userId: ids.assignee } },
      ...over,
    },
  })

describe('writing tasks', () => {
  it('a project lead writes anywhere; a member cannot write at all', async () => {
    const byLead = await request('POST', `/api/projects/${projectId}/tasks`, cookies.lead, {
      title: 'Order steel',
      assigneeIds: [ids.bystander],
    })
    expect(byLead.status).toBe(201)
    expect(await byLead.json()).toMatchObject({
      teamId: null,
      assignees: [{ userId: ids.bystander }],
    })

    const byMember = await request(
      'POST',
      `/api/projects/${projectId}/tasks`,
      cookies.assignee,
      { title: 'Nope' },
    )
    expect(byMember.status).toBe(403)
  })

  it("a team lead's task lands on their own team, asked for or not", async () => {
    const unasked = await request(
      'POST',
      `/api/projects/${projectId}/tasks`,
      cookies.teamLead,
      { title: 'Wire the board' },
    )
    expect(unasked.status).toBe(201)
    expect(await unasked.json()).toMatchObject({ teamId })

    const elsewhere = await request(
      'POST',
      `/api/projects/${projectId}/tasks`,
      cookies.teamLead,
      { title: 'Wire their board', teamId: otherTeamId },
    )
    expect(elsewhere.status).toBe(403)
  })

  it('refuses an assignee who is not on the project', async () => {
    const outsider = await prisma.user.create({
      data: { fullName: 'Tasks outsider', email: email('outsider') },
    })

    const response = await request(
      'POST',
      `/api/projects/${projectId}/tasks`,
      cookies.lead,
      { title: 'Ghost work', assigneeIds: [outsider.id] },
    )

    expect(response.status).toBe(400)
  })
})

describe('ticking tasks', () => {
  it('an assignee ticks their own task, and the record says who', async () => {
    const task = await seedTask()

    const response = await request(
      'POST',
      `/api/tasks/${task.id}/status`,
      cookies.assignee,
      { status: 'DONE' },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      status: 'DONE',
      completedByName: 'Tasks assignee',
    })
  })

  it('a bystander on the project cannot tick somebody else\'s task', async () => {
    const task = await seedTask()

    const response = await request(
      'POST',
      `/api/tasks/${task.id}/status`,
      cookies.bystander,
      { status: 'DONE' },
    )

    expect(response.status).toBe(403)
  })

  it('reopening clears who completed it', async () => {
    const task = await seedTask()
    await request('POST', `/api/tasks/${task.id}/status`, cookies.assignee, {
      status: 'DONE',
    })

    const response = await request(
      'POST',
      `/api/tasks/${task.id}/status`,
      cookies.teamLead,
      { status: 'OPEN' },
    )

    expect(await response.json()).toMatchObject({
      status: 'OPEN',
      completedByName: null,
      completedAt: null,
    })
  })
})

describe('editing and deleting', () => {
  it('the project lead edits any task; reassignment replaces the list', async () => {
    const task = await seedTask()

    const response = await request('PATCH', `/api/tasks/${task.id}`, cookies.lead, {
      title: 'CAD the whole chassis',
      assigneeIds: [ids.bystander],
    })

    expect(response.status).toBe(200)
    const updated = (await response.json()) as {
      assignees: { userId: string }[]
    }
    expect(updated.assignees).toEqual([
      expect.objectContaining({ userId: ids.bystander }),
    ])
  })

  it("a team lead cannot touch another team's task, even as its creator", async () => {
    // Created by the team lead, then moved off their team by the lead —
    // creator-ship alone must not keep the door open.
    const task = await seedTask({ teamId: otherTeamId })

    const response = await request(
      'PATCH',
      `/api/tasks/${task.id}`,
      cookies.teamLead,
      { title: 'Still mine?' },
    )

    expect(response.status).toBe(403)
  })

  it('an assignee can tick but not delete', async () => {
    const task = await seedTask()

    expect(
      (await request('DELETE', `/api/tasks/${task.id}`, cookies.assignee)).status,
    ).toBe(403)
    expect(
      (await request('DELETE', `/api/tasks/${task.id}`, cookies.teamLead)).status,
    ).toBe(200)
  })
})

describe('reading tasks', () => {
  it('members see the whole project board; strangers see nothing', async () => {
    await seedTask()

    const board = await request(
      'GET',
      `/api/projects/${projectId}/tasks`,
      cookies.bystander,
    )
    expect(board.status).toBe(200)
    expect((await board.json()) as unknown[]).toHaveLength(1)

    const outsider = await prisma.user.create({
      data: { fullName: 'Tasks stranger', email: email('stranger') },
    })
    const denied = await request(
      'GET',
      `/api/projects/${projectId}/tasks`,
      await cookieFor(outsider.id),
    )
    expect(denied.status).toBe(403)
  })

  it('/api/me/tasks lists my open work and drops it once done', async () => {
    const task = await seedTask()

    const before = await request('GET', '/api/me/tasks', cookies.assignee)
    expect((await before.json()) as unknown[]).toEqual([
      expect.objectContaining({ id: task.id, project: expect.objectContaining({ title: 'Tasks Rover' }) }),
    ])

    await request('POST', `/api/tasks/${task.id}/status`, cookies.assignee, {
      status: 'DONE',
    })

    const after = await request('GET', '/api/me/tasks', cookies.assignee)
    expect((await after.json()) as unknown[]).toEqual([])
  })
})
