import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../../app.js'
import { prisma } from '../../core/db.js'
import { env } from '../../core/env.js'
import {
  ProjectMemberRank,
  Season,
  UserRole,
} from '../../generated/prisma/enums.js'
import { createSession } from '../../auth/session.js'
import { currentTerm } from '../../membership/semester.js'

/**
 * Tasks, against the live database. The scoping mirrors events — team lead on their own board,
 * project lead everywhere in the project — so what earns its keep here is the part that's looser
 * on purpose: an assignee may tick their own task whatever their rank, and nobody else below lead
 * may touch it.
 */

const PREFIX = 'test-tasks-'
const email = (name: string) => `${PREFIX}${name}@ucf.edu`

const clearWindows = () =>
  prisma.rateLimit.deleteMany({ where: { key: { startsWith: 'tasks:' } } })

const clearRows = async () => {
  await prisma.project.deleteMany({ where: { slug: { startsWith: PREFIX } } })
  // A task with no project is reachable by neither delete above, which is why it needs its own.
  // Deleting the fixture projects cascades their tasks; deleting the fixture users cascades
  // `task_assignees` but not the task, because `Task.createdById` is `SetNull` by design — an
  // officer leaving must not delete the club's work. So a project-less fixture survives both and
  // is namespaced by title instead.
  await prisma.task.deleteMany({
    where: { projectId: null, title: { startsWith: PREFIX } },
  })
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
}

async function cookieFor(userId: string): Promise<string> {
  const { token } = await createSession(userId)
  return `${env.SESSION_COOKIE_NAME}=${token}`
}

type Who = 'lead' | 'teamLead' | 'assignee' | 'bystander' | 'officer'

let cookies: Record<Who, string>
let ids: Record<Who, string>
let projectId: string
let teamId: string
let otherTeamId: string
/** A build that finished, for the one rule that is about the calendar. */
let pastProjectId: string

beforeEach(async () => {
  await clearWindows()
  await clearRows()

  const [lead, teamLead, assignee, bystander, officer] = await Promise.all(
    (['lead', 'teamLead', 'assignee', 'bystander', 'officer'] as const).map(
      (name) =>
        prisma.user.create({
          data: {
            fullName: `Tasks ${name}`,
            email: email(name),
            // The officer is one because of this column and nothing else —
            // `isOfficer` reads the session's role, and no route here goes
            // near dues or Discord, so no standing is needed to reach any of
            // it. A club-wide task is the one thing only they can write.
            role: name === 'officer' ? UserRole.OFFICER : UserRole.MEMBER,
          },
        }),
    ),
  )

  // Read the term rather than pinning one, the rule `print.test.ts` follows: new tasks may only go
  // on a project running this semester, so a fixture stamped with a literal year is refused for a
  // fortnight every August — and refused as a 409, which reads like the route being broken rather
  // than the fixture being out of date.
  const term = await currentTerm()

  const project = await prisma.project.create({
    data: {
      slug: `${PREFIX}rover`,
      title: 'Tasks Rover',
      termYear: term.year,
      termSeason: term.season,
      teams: { create: [{ name: 'Alpha' }, { name: 'Beta' }] },
    },
    include: { teams: true },
  })
  projectId = project.id
  teamId = project.teams.find((t) => t.name === 'Alpha')!.id
  otherTeamId = project.teams.find((t) => t.name === 'Beta')!.id

  // Far enough back that no calendar correction can make it current again.
  const past = await prisma.project.create({
    data: {
      slug: `${PREFIX}old-rover`,
      title: 'Tasks Old Rover',
      termYear: 2020,
      termSeason: Season.SPRING,
    },
  })
  pastProjectId = past.id

  await prisma.projectMember.createMany({
    data: [
      { projectId, userId: lead.id, rank: ProjectMemberRank.PROJECT_LEAD },
      { projectId, userId: teamLead.id, rank: ProjectMemberRank.TEAM_LEAD, teamId },
      { projectId, userId: assignee.id, teamId },
      { projectId, userId: bystander.id },
      // The same lead on last year's build, so the refusal below is about the
      // term and provably not about their rank.
      { projectId: past.id, userId: lead.id, rank: ProjectMemberRank.PROJECT_LEAD },
      { projectId: past.id, userId: assignee.id },
    ],
  })

  ids = {
    lead: lead.id,
    teamLead: teamLead.id,
    assignee: assignee.id,
    bystander: bystander.id,
    officer: officer.id,
  }
  cookies = {
    lead: await cookieFor(lead.id),
    teamLead: await cookieFor(teamLead.id),
    assignee: await cookieFor(assignee.id),
    bystander: await cookieFor(bystander.id),
    officer: await cookieFor(officer.id),
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

describe('the five labels', () => {
  it('every label round-trips, and only DONE records who finished it', async () => {
    const task = await seedTask()

    for (const status of [
      'IN_PROGRESS',
      'DELAYED',
      'DONE',
      'CANCELED',
    ] as const) {
      const response = await request(
        'POST',
        `/api/tasks/${task.id}/status`,
        cookies.assignee,
        { status },
      )

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        status,
        // Cancelling is not completing. Every label but DONE clears the pair,
        // so the columns describe the row as it stands rather than as it was
        // one press ago.
        completedByName: status === 'DONE' ? 'Tasks assignee' : null,
        completedAt: status === 'DONE' ? expect.any(String) : null,
      })
    }
  })

  it('refuses a label that is not one of the five', async () => {
    const task = await seedTask()

    const response = await request(
      'POST',
      `/api/tasks/${task.id}/status`,
      cookies.assignee,
      { status: 'BLOCKED' },
    )

    expect(response.status).toBe(400)
  })
})

describe('a task with no project', () => {
  it('officers write one; a project lead cannot', async () => {
    const byOfficer = await request('POST', '/api/tasks', cookies.officer, {
      title: `${PREFIX}Order the shirts`,
      assigneeIds: [ids.bystander],
    })

    expect(byOfficer.status).toBe(201)
    expect(await byOfficer.json()).toMatchObject({
      projectId: null,
      teamId: null,
      project: null,
      assignees: [{ userId: ids.bystander }],
    })

    // A lead's authority comes from a project, so with no project there is
    // nothing for them to derive it from — the rule club-wide events follow.
    const byLead = await request('POST', '/api/tasks', cookies.lead, {
      title: `${PREFIX}Order the shirts myself`,
      assigneeIds: [ids.bystander],
    })
    expect(byLead.status).toBe(403)
  })

  it('has to belong to somebody, on the way in and on the way past', async () => {
    const empty = await request('POST', '/api/tasks', cookies.officer, {
      title: `${PREFIX}Belongs to nobody`,
      assigneeIds: [],
    })
    expect(empty.status).toBe(400)

    const created = await request('POST', '/api/tasks', cookies.officer, {
      title: `${PREFIX}Book the room`,
      assigneeIds: [ids.bystander],
    })
    const task = (await created.json()) as { id: string }

    // The edit route is the other way in, and it can empty a list the create
    // route insisted on. `checkAssignees` is what refuses both.
    const emptied = await request(
      'PATCH',
      `/api/tasks/${task.id}`,
      cookies.officer,
      { assigneeIds: [] },
    )
    expect(emptied.status).toBe(400)
  })

  it('is the officers to manage, and nobody elses', async () => {
    const created = await request('POST', '/api/tasks', cookies.officer, {
      title: `${PREFIX}Chase the sponsor`,
      assigneeIds: [ids.assignee],
    })
    const task = (await created.json()) as { id: string }

    // A project lead is a stranger to it: there is no membership row that could
    // grant a rank over a task belonging to no project.
    expect(
      (
        await request('PATCH', `/api/tasks/${task.id}`, cookies.lead, {
          title: 'Mine now',
        })
      ).status,
    ).toBe(403)

    // The assignee still moves it between labels — the looseness that has
    // always applied to whoever the work was given to.
    expect(
      (
        await request('POST', `/api/tasks/${task.id}/status`, cookies.assignee, {
          status: 'IN_PROGRESS',
        })
      ).status,
    ).toBe(200)
  })
})

describe('the calendar opt-in', () => {
  it('belongs to the assignee, one person at a time', async () => {
    const task = await prisma.task.create({
      data: {
        projectId,
        teamId,
        title: 'Cut the brackets',
        dueAt: new Date('2035-09-10T22:00:00Z'),
        assignees: {
          create: [{ userId: ids.assignee }, { userId: ids.bystander }],
        },
      },
    })

    const on = await request(
      'POST',
      `/api/tasks/${task.id}/calendar`,
      cookies.assignee,
      { onCalendar: true },
    )
    expect(on.status).toBe(200)

    const rows = await prisma.taskAssignee.findMany({
      where: { taskId: task.id },
      select: { userId: true, onCalendar: true },
    })
    // The other assignee is untouched: two people share the task and only one
    // of them asked for it in their week.
    expect(rows).toEqual(
      expect.arrayContaining([
        { userId: ids.assignee, onCalendar: true },
        { userId: ids.bystander, onCalendar: false },
      ]),
    )

    // Even the project lead cannot put it on somebody's calendar.
    expect(
      (
        await request('POST', `/api/tasks/${task.id}/calendar`, cookies.lead, {
          onCalendar: true,
        })
      ).status,
    ).toBe(403)
  })

  it('shows an opted-in deadline to that member and to nobody else', async () => {
    const task = await prisma.task.create({
      data: {
        projectId,
        title: 'Submit the design review',
        dueAt: new Date('2035-09-10T22:00:00Z'),
        assignees: {
          create: [
            { userId: ids.assignee, onCalendar: true },
            { userId: ids.bystander },
          ],
        },
      },
    })

    const window = 'from=2035-09-01T00:00:00.000Z&to=2035-10-01T00:00:00.000Z'
    const entryId = `task:${task.id}`

    const mine = (await (
      await request('GET', `/api/me/events?${window}`, cookies.assignee)
    ).json()) as { id: string; type: string; title: string }[]

    // Found by id rather than counted: this endpoint answers with the club's
    // real published events too, and a count would pass or fail on whatever
    // happens to be in the database that day.
    expect(mine.find((row) => row.id === entryId)).toMatchObject({
      type: 'TASK',
      title: 'Due: Submit the design review',
    })

    // Assigned, but never asked for it.
    const theirs = (await (
      await request('GET', `/api/me/events?${window}`, cookies.bystander)
    ).json()) as { id: string }[]
    expect(theirs.find((row) => row.id === entryId)).toBeUndefined()

    // Not assigned at all, and an officer at that — the widest reader there is.
    const officers = (await (
      await request('GET', `/api/me/events?${window}`, cookies.officer)
    ).json()) as { id: string }[]
    expect(officers.find((row) => row.id === entryId)).toBeUndefined()
  })

  it('never reaches the public calendar, whatever anybody opted into', async () => {
    await prisma.task.create({
      data: {
        projectId,
        title: 'Definitely not public',
        dueAt: new Date('2035-09-10T22:00:00Z'),
        assignees: { create: { userId: ids.assignee, onCalendar: true } },
      },
    })

    const response = await app.request(
      '/api/events?when=all&from=2035-09-01T00:00:00.000Z&to=2035-10-01T00:00:00.000Z',
    )
    const events = (await response.json()) as { id: string }[]

    // An invariant rather than a count: no row on the anonymous calendar is
    // ever a task, whoever asked for it and whatever their project says.
    expect(events.some((row) => row.id.startsWith('task:'))).toBe(false)
  })

  it('drops off the calendar once it is settled', async () => {
    const task = await prisma.task.create({
      data: {
        projectId,
        title: 'Finish the wiring',
        dueAt: new Date('2035-09-10T22:00:00Z'),
        assignees: { create: { userId: ids.assignee, onCalendar: true } },
      },
    })

    const window = 'from=2035-09-01T00:00:00.000Z&to=2035-10-01T00:00:00.000Z'
    await request('POST', `/api/tasks/${task.id}/status`, cookies.assignee, {
      status: 'CANCELED',
    })

    const after = (await (
      await request('GET', `/api/me/events?${window}`, cookies.assignee)
    ).json()) as { id: string }[]

    expect(after.find((row) => row.id === `task:${task.id}`)).toBeUndefined()
  })
})

describe('reading across projects', () => {
  it('scope=managed gives a team lead their own team and nothing else', async () => {
    const mine = await seedTask({ title: 'On my team' })
    const theirs = await seedTask({
      title: 'On the other team',
      teamId: otherTeamId,
    })
    const wide = await seedTask({ title: 'Whole project', teamId: null })

    const response = await request(
      'GET',
      '/api/me/tasks?scope=managed&status=all&limit=200',
      cookies.teamLead,
    )

    const found = ((await response.json()) as { id: string }[]).map(
      (row) => row.id,
    )

    // Exactly the scope `requireTaskManager` grants them, which is the property
    // worth pinning: the filter and the guard have to agree, or the page offers
    // an EDIT button the server then refuses.
    expect(found).toContain(mine.id)
    expect(found).not.toContain(theirs.id)
    expect(found).not.toContain(wide.id)
  })

  it('open now spans the three unsettled labels', async () => {
    const task = await seedTask()

    await request('POST', `/api/tasks/${task.id}/status`, cookies.assignee, {
      status: 'DELAYED',
    })

    // The overview card takes the defaults. Something a member has flagged as
    // slipping is still work they owe, so it stays on the list.
    const open = (await (
      await request('GET', '/api/me/tasks', cookies.assignee)
    ).json()) as { id: string }[]
    expect(open.map((row) => row.id)).toContain(task.id)

    await request('POST', `/api/tasks/${task.id}/status`, cookies.assignee, {
      status: 'CANCELED',
    })

    const settled = (await (
      await request('GET', '/api/me/tasks', cookies.assignee)
    ).json()) as { id: string }[]
    expect(settled.map((row) => row.id)).not.toContain(task.id)
  })

  it('gives somebody who leads nothing an empty managed list', async () => {
    await seedTask({ title: 'Not for the bystander' })

    const response = await request(
      'GET',
      '/api/me/tasks?scope=managed&status=all',
      cookies.bystander,
    )

    // Leading nothing is managing nothing, and the empty filter has to match no
    // rows rather than every row — the one way this could fail open.
    expect((await response.json()) as unknown[]).toEqual([])
  })
})

describe('only a project running this semester takes new work', () => {
  it('refuses a new task on a finished project, and says which term it is', async () => {
    const response = await request(
      'POST',
      `/api/projects/${pastProjectId}/tasks`,
      cookies.lead,
      { title: 'One more thing', assigneeIds: [ids.assignee] },
    )

    expect(response.status).toBe(409)
    const { error } = (await response.json()) as { error: string }
    // Names both terms. "Not current" means nothing to somebody with three
    // rows called TapeMeasure on their dashboard.
    expect(error).toContain('Tasks Old Rover')
    expect(error).toContain('Spring 2020')
  })

  it('refuses an officer too — this is the calendar, not a permission', async () => {
    const response = await request(
      'POST',
      `/api/projects/${pastProjectId}/tasks`,
      cookies.officer,
      { title: 'Officers are not exempt', assigneeIds: [ids.assignee] },
    )

    expect(response.status).toBe(409)
  })

  it('answers about the term before it answers about the rank', async () => {
    // A stranger to the project asking for a finished one gets the 409 rather
    // than a 403: the route checks the calendar first, deliberately, because
    // the fact that stops everybody is the more useful sentence.
    const response = await request(
      'POST',
      `/api/projects/${pastProjectId}/tasks`,
      cookies.bystander,
      { title: 'Not on this project at all' },
    )

    expect(response.status).toBe(409)
  })

  it('still 404s for a project that does not exist', async () => {
    const response = await request(
      'POST',
      '/api/projects/01a04fbb-ca35-706f-9d7b-b624f397fbaa/tasks',
      cookies.officer,
      { title: 'Nowhere' },
    )

    expect(response.status).toBe(404)
  })

  it('leaves last term’s board editable, tickable and deletable', async () => {
    // The rule is about *new* work. Closing out what is already on a finished
    // project is the normal way a semester ends, and a board that froze on the
    // last day of term would strand every unticked row on it.
    const task = await prisma.task.create({
      data: {
        projectId: pastProjectId,
        title: 'Left over from spring',
        assignees: { create: { userId: ids.assignee } },
      },
    })

    expect(
      (
        await request('POST', `/api/tasks/${task.id}/status`, cookies.assignee, {
          status: 'DONE',
        })
      ).status,
    ).toBe(200)

    expect(
      (
        await request('PATCH', `/api/tasks/${task.id}`, cookies.lead, {
          title: 'Left over, tidied',
        })
      ).status,
    ).toBe(200)

    expect(
      (await request('DELETE', `/api/tasks/${task.id}`, cookies.lead)).status,
    ).toBe(200)
  })

  it('does not touch a task that belongs to no project', async () => {
    // There is no term to be out of. The officers' own work is not seasonal.
    const response = await request('POST', '/api/tasks', cookies.officer, {
      title: `${PREFIX}Order the shirts`,
      assigneeIds: [ids.bystander],
    })

    expect(response.status).toBe(201)
  })
})
