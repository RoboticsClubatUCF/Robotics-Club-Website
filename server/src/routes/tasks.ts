import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { isOfficer, membershipOf, requireProjectMember } from '../authz.js'
import { prisma } from '../db.js'
import {
  ProjectMemberRank,
  TaskStatus,
} from '../generated/prisma/enums.js'
import { rateLimit } from '../rateLimit.js'
import { type AuthEnv, type SessionUser, originGuard, requireAuth } from '../session.js'

/**
 * Tasks: the checklist a lead writes and the members tick.
 *
 *   GET    /api/projects/:id/tasks  -> the project's board (members)
 *   POST   /api/projects/:id/tasks  -> write one (leads, scoped below)
 *   PATCH  /api/tasks/:id           -> edit / reassign (same scope)
 *   DELETE /api/tasks/:id           -> delete (same scope)
 *   POST   /api/tasks/:id/status    -> tick or untick (assignees + leads)
 *
 * The scoping rule is the same shape events use: a team lead writes against
 * their own team and nothing else; the project lead writes against any team
 * or none; officers pass everywhere. Ticking is looser than writing on
 * purpose — the person the task was assigned to is exactly who should be able
 * to mark it done, whatever their rank.
 */
export const tasks = new Hono<AuthEnv>()

/** Laying out a work session is a dozen writes; sixty covers a planning night. */
const writes = rateLimit('tasks', 60)

const taskSelect = {
  id: true,
  projectId: true,
  teamId: true,
  title: true,
  details: true,
  dueAt: true,
  status: true,
  completedAt: true,
  completedBy: { select: { fullName: true } },
  createdById: true,
  assignees: {
    select: { userId: true, user: { select: { fullName: true } } },
  },
} as const

/** Flatten the join rows — the wire shape is `{userId, fullName}[]`. */
function wire(task: {
  assignees: { userId: string; user: { fullName: string } }[]
  completedBy: { fullName: string } | null
  [key: string]: unknown
}) {
  const { assignees, completedBy, ...rest } = task
  return {
    ...rest,
    completedByName: completedBy?.fullName ?? null,
    assignees: assignees.map(({ userId, user }) => ({
      userId,
      fullName: user.fullName,
    })),
  }
}

const taskBody = z.object({
  title: z.string().trim().min(1).max(200),
  details: z.string().trim().max(5_000).nullable().optional(),
  dueAt: z.coerce.date().nullable().optional(),
  teamId: z.uuid().nullable().optional(),
  assigneeIds: z.array(z.uuid()).max(50).default([]),
})

/**
 * Who may write tasks where. Returns the teamId the task must carry — which
 * for a team lead is *their* team no matter what the body said, refused
 * rather than silently rewritten if they asked for another.
 */
async function writingScope(
  user: SessionUser,
  projectId: string,
  askedTeamId: string | null | undefined,
): Promise<string | null> {
  const forbidden = new HTTPException(403, {
    message: 'You do not have permission to do that.',
  })

  const membership = await membershipOf(user.id, projectId)
  const officer = isOfficer(user)

  if (!officer && membership?.rank !== ProjectMemberRank.PROJECT_LEAD) {
    if (membership?.rank !== ProjectMemberRank.TEAM_LEAD || !membership.teamId) {
      throw forbidden
    }
    // A team lead writes on their own team's board, full stop.
    if (askedTeamId !== undefined && askedTeamId !== membership.teamId) {
      throw forbidden
    }
    return membership.teamId
  }

  if (askedTeamId) {
    const team = await prisma.team.findUnique({
      where: { id: askedTeamId },
      select: { projectId: true },
    })
    if (team?.projectId !== projectId) {
      throw new HTTPException(400, {
        message: 'That team is not part of this project.',
      })
    }
  }

  return askedTeamId ?? null
}

/** Everyone assigned has to actually be on the project, checked in one query. */
async function checkAssignees(projectId: string, userIds: string[]) {
  if (userIds.length === 0) return

  const found = await prisma.projectMember.count({
    where: { projectId, userId: { in: userIds } },
  })

  if (found !== new Set(userIds).size) {
    throw new HTTPException(400, {
      message: 'Everyone assigned has to be a member of this project.',
    })
  }
}

async function getTask(id: string) {
  const task = await prisma.task.findUnique({
    where: { id },
    select: { id: true, projectId: true, teamId: true, status: true },
  })
  if (!task) throw new HTTPException(404, { message: 'No such task' })
  return task
}

/** The write scope, re-derived against the task's own team. */
async function requireTaskManager(
  user: SessionUser,
  task: { projectId: string; teamId: string | null },
): Promise<void> {
  if (isOfficer(user)) return

  const membership = await membershipOf(user.id, task.projectId)
  const allowed =
    membership?.rank === ProjectMemberRank.PROJECT_LEAD ||
    (membership?.rank === ProjectMemberRank.TEAM_LEAD &&
      task.teamId !== null &&
      membership.teamId === task.teamId)

  if (!allowed) {
    throw new HTTPException(403, {
      message: 'You do not have permission to do that.',
    })
  }
}

// ------------------------------------------------------------------- routes

tasks.get('/projects/:id/tasks', requireAuth, async (c) => {
  const projectId = c.req.param('id')

  if (!(await prisma.project.findUnique({ where: { id: projectId } }))) {
    throw new HTTPException(404, { message: 'No such project' })
  }
  await requireProjectMember(c.get('user'), projectId)

  const rows = await prisma.task.findMany({
    where: { projectId },
    // Open work first, nearest deadline first, undated work after that.
    orderBy: [
      { status: 'asc' },
      { dueAt: { sort: 'asc', nulls: 'last' } },
      { createdAt: 'desc' },
    ],
    select: taskSelect,
  })

  return c.json(rows.map(wire))
})

tasks.post(
  '/projects/:id/tasks',
  originGuard,
  requireAuth,
  writes,
  zValidator('json', taskBody),
  async (c) => {
    const user = c.get('user')
    const projectId = c.req.param('id')
    const { assigneeIds, teamId: askedTeamId, ...data } = c.req.valid('json')

    if (!(await prisma.project.findUnique({ where: { id: projectId } }))) {
      throw new HTTPException(404, { message: 'No such project' })
    }

    const teamId = await writingScope(user, projectId, askedTeamId)
    await checkAssignees(projectId, assigneeIds)

    const task = await prisma.task.create({
      data: {
        ...data,
        projectId,
        teamId,
        createdById: user.id,
        assignees: {
          create: [...new Set(assigneeIds)].map((userId) => ({ userId })),
        },
      },
      select: taskSelect,
    })

    return c.json(wire(task), 201)
  },
)

/** Like events, a task stays where it was written — no `teamId` moves here. */
const taskPatch = taskBody.omit({ teamId: true }).partial()

tasks.patch(
  '/tasks/:id',
  originGuard,
  requireAuth,
  writes,
  zValidator('json', taskPatch),
  async (c) => {
    const user = c.get('user')
    const { assigneeIds, ...data } = c.req.valid('json')

    const task = await getTask(c.req.param('id'))
    await requireTaskManager(user, task)

    if (assigneeIds) {
      await checkAssignees(task.projectId, assigneeIds)
    }

    const updated = await prisma.task.update({
      where: { id: task.id },
      data: {
        ...data,
        ...(assigneeIds
          ? {
              assignees: {
                deleteMany: {},
                create: [...new Set(assigneeIds)].map((userId) => ({ userId })),
              },
            }
          : {}),
      },
      select: taskSelect,
    })

    return c.json(wire(updated))
  },
)

tasks.delete('/tasks/:id', originGuard, requireAuth, writes, async (c) => {
  const task = await getTask(c.req.param('id'))
  await requireTaskManager(c.get('user'), task)

  await prisma.task.delete({ where: { id: task.id } })

  return c.json({ deleted: true })
})

tasks.post(
  '/tasks/:id/status',
  originGuard,
  requireAuth,
  writes,
  zValidator('json', z.object({ status: z.enum(TaskStatus) })),
  async (c) => {
    const user = c.get('user')
    const { status } = c.req.valid('json')

    const task = await getTask(c.req.param('id'))

    // Assignees may tick their own work; everyone else needs the write scope.
    const assigned = await prisma.taskAssignee.findUnique({
      where: { taskId_userId: { taskId: task.id, userId: user.id } },
    })
    if (!assigned) await requireTaskManager(user, task)

    const updated = await prisma.task.update({
      where: { id: task.id },
      data:
        status === TaskStatus.DONE
          ? { status, completedById: user.id, completedAt: new Date() }
          : // Reopening clears the record — a task that is open again was not
            // completed by anyone, whatever happened last week.
            { status, completedById: null, completedAt: null },
      select: taskSelect,
    })

    return c.json(wire(updated))
  },
)
