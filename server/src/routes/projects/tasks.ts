import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { validate } from '../../core/validate.js'
import { isOfficer, membershipOf, requireProjectMember } from '../../auth/authz.js'
import { prisma } from '../../core/db.js'
import { currentTerm } from '../../membership/semester.js'
import { isCurrentTerm } from '../../projects/projectTerm.js'
import type { Prisma } from '../../generated/prisma/client.js'
import {
  ProjectMemberRank,
  type Season,
  TaskStatus,
} from '../../generated/prisma/enums.js'
import { rateLimit } from '../../core/rateLimit.js'
import { type AuthEnv, type SessionUser, originGuard, requireAuth } from '../../auth/session.js'

/**
 * Tasks: the checklist a lead writes and the members tick.
 *
 *   GET    /api/projects/:id/tasks  -> the project's board (members)
 *   POST   /api/projects/:id/tasks  -> write one (leads, scoped below)
 *   POST   /api/tasks               -> write one that belongs to no project
 *   PATCH  /api/tasks/:id           -> edit / reassign (same scope)
 *   DELETE /api/tasks/:id           -> delete (same scope)
 *   POST   /api/tasks/:id/status    -> move it between labels (assignees + leads)
 *   POST   /api/tasks/:id/calendar  -> put it on my own calendar (assignees)
 *
 * The scoping rule is the shape events use: a team lead writes against their own team,
 * the project lead against any team or none, officers pass everywhere. Ticking is
 * looser than writing on purpose — the person the task was assigned to is exactly who
 * should be able to mark it done.
 *
 * A task belongs to a project or to a person. `POST /api/tasks` is the second kind —
 * "order the shirts" — and it's officers only, because a lead's authority is derived
 * from a project and there's none here to derive it from. Such a task must name an
 * assignee: with neither a project nor a person it would appear on no page at all.
 *
 * The calendar opt-in belongs to the assignee, not whoever wrote the task. A lead may
 * put work on somebody's list; putting it in their week is theirs to decide, which is
 * why `TaskAssignee.onCalendar` is a column per person rather than one per task.
 */
export const tasks = new Hono<AuthEnv>()

/** Laying out a work session is a dozen writes; sixty covers a planning night. */
const writes = rateLimit('tasks', 60)

/**
 * One shape for both readers — the project's own board and the cross-project list at
 * `/api/me/tasks`, which imports this rather than declaring a second one. The board
 * pays for a `project` and `team` it already knows; a few dozen bytes against two
 * selects that would drift the first time either gained a column.
 */
export const taskSelect = {
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
  createdAt: true,
  project: { select: { slug: true, title: true } },
  team: { select: { name: true } },
  assignees: {
    select: {
      userId: true,
      onCalendar: true,
      user: { select: { fullName: true } },
    },
  },
} as const

/** Flatten the join rows — the wire shape is `{userId, fullName, onCalendar}[]`. */
export function wire(task: {
  assignees: {
    userId: string
    onCalendar: boolean
    user: { fullName: string }
  }[]
  completedBy: { fullName: string } | null
  [key: string]: unknown
}) {
  const { assignees, completedBy, ...rest } = task
  return {
    ...rest,
    completedByName: completedBy?.fullName ?? null,
    assignees: assignees.map(({ userId, onCalendar, user }) => ({
      userId,
      fullName: user.fullName,
      onCalendar,
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
 * A task with no project behind it. No `teamId` — a team is part of a project — and at
 * least one assignee, because a task belonging to neither a build nor a person belongs
 * to nothing. `.min(1)` says that on the way in; `checkAssignees` says it again for the
 * edit route, which can empty the list on a task that already exists.
 */
const directTaskBody = taskBody.omit({ teamId: true }).extend({
  assigneeIds: z.array(z.uuid()).min(1).max(50),
})

/**
 * Who may write tasks where. Returns the teamId the task must carry — which for a team
 * lead is their team no matter what the body said, refused rather than silently
 * rewritten if they asked for another.
 */
async function writingScope(
  user: SessionUser,
  projectId: string | null,
  askedTeamId: string | null | undefined,
): Promise<string | null> {
  const forbidden = new HTTPException(403, {
    message: 'You do not have permission to do that.',
  })

  // No project means the club's own work, and that's the officers'. A lead's authority
  // is derived from a membership row, so with no project there's nothing to derive it
  // from — the same reason `eventManage.ts` refuses a club-wide event to anybody but an
  // officer. The rule lives here so both writers ask one function.
  if (projectId === null) {
    if (!isOfficer(user)) {
      throw new HTTPException(403, {
        message: 'Only officers can assign a task that belongs to no project.',
      })
    }
    return null
  }

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

/**
 * Everyone assigned has to actually be somebody, checked in one query.
 *
 * Two questions, because a task with no project has no roster to check against. With
 * one, the roster is the answer and an empty list is fine — a lead may write a task
 * down before deciding who does it. Without one, the only people who can be meant are
 * current members, and the list may not be empty.
 */
async function checkAssignees(projectId: string | null, userIds: string[]) {
  const wanted = new Set(userIds).size

  if (projectId === null) {
    if (wanted === 0) {
      throw new HTTPException(400, {
        message: 'A task with no project has to be assigned to somebody.',
      })
    }

    const found = await prisma.user.count({
      where: { id: { in: userIds }, active: true },
    })

    if (found !== wanted) {
      throw new HTTPException(400, {
        message: 'Everyone assigned has to be a current member of the club.',
      })
    }
    return
  }

  if (wanted === 0) return

  const found = await prisma.projectMember.count({
    where: { projectId, userId: { in: userIds } },
  })

  if (found !== wanted) {
    throw new HTTPException(400, {
      message: 'Everyone assigned has to be a member of this project.',
    })
  }
}

/**
 * The project a new task may be written against: one the club is running this semester.
 *
 * A project belongs to a term, and a build that ran three semesters is three rows — so
 * without this a lead opening last spring's manage page could add work to a project
 * nobody meets for, and it would land on somebody's dashboard looking like this week's.
 * The rule is about new tasks only: last term's board stays editable and tickable.
 *
 * `isCurrentTerm` is exact equality against `currentTerm()`, which names the term ahead
 * during a break — so a task written over winter break belongs to spring. That's the
 * same answer `/me/projects` marks rows `current` with, which keeps the page's picker
 * and this refusal agreeing.
 */
/**
 * "Fall 2026", for a refusal a human reads.
 *
 * Local rather than exported: nothing else on the server prints a term, and a shared
 * helper with one caller is a file somebody has to go and find.
 */
const termName = (term: { year: number; season: Season }) =>
  `${term.season.charAt(0)}${term.season.slice(1).toLowerCase()} ${String(term.year)}`

async function requireCurrentProject(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { title: true, termYear: true, termSeason: true },
  })

  if (!project) throw new HTTPException(404, { message: 'No such project' })

  const term = await currentTerm()
  if (!isCurrentTerm(project, term)) {
    // 409 rather than 403: they're allowed to do this, just not here. The sentence names
    // both terms, because "not current" is meaningless to somebody with three rows
    // called TapeMeasure on their dashboard.
    throw new HTTPException(409, {
      message: `${project.title} is a ${termName({ year: project.termYear, season: project.termSeason })} project, and new tasks can only go on a project running this semester (${termName(term)}).`,
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
  task: { projectId: string | null; teamId: string | null },
): Promise<void> {
  if (isOfficer(user)) return

  // Nothing below an officer manages a task with no project: there's no membership row
  // to read a rank off. The mirror of `writingScope` above.
  if (task.projectId === null) {
    throw new HTTPException(403, {
      message: 'You do not have permission to do that.',
    })
  }

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

/**
 * The same scope as a `where`, for reading a person's whole desk at once.
 *
 * `requireTaskManager` answers "may this person touch that task"; the tasks page asks
 * the other direction, and a page can't answer that by calling a guard once per row.
 * Exported so `routes/member/me.ts` reads it rather than restating the rule.
 *
 * It must agree with `requireTaskManager`, and there's a test that walks a team lead's
 * rows to say so.
 */
export async function manageableTaskFilter(
  user: SessionUser,
): Promise<Prisma.TaskWhereInput> {
  // Officers run the club, so the scope is everything — the exemption every
  // check in `authz.ts` opens with.
  if (isOfficer(user)) return {}

  const memberships = await prisma.projectMember.findMany({
    where: { userId: user.id, rank: { not: ProjectMemberRank.MEMBER } },
    select: { projectId: true, rank: true, teamId: true },
  })

  const led = memberships
    .filter((m) => m.rank === ProjectMemberRank.PROJECT_LEAD)
    .map((m) => m.projectId)

  // A team lead reaches their own team's board and nothing else, which is what
  // `writingScope` enforces on the way in. Matched on the pair rather than `teamId`
  // alone: a team id is unique today, and a filter that says so goes on being right if
  // that ever stops being true.
  const teams = memberships
    .filter((m) => m.rank === ProjectMemberRank.TEAM_LEAD && m.teamId !== null)
    .map((m) => ({ projectId: m.projectId, teamId: m.teamId }))

  // Leading nothing is managing nothing. Spelled out rather than left to an empty `OR`,
  // because "no conditions" is the one filter that would hand somebody every task in
  // the club.
  if (led.length === 0 && teams.length === 0) return { id: { in: [] } }

  return {
    OR: [...(led.length > 0 ? [{ projectId: { in: led } }] : []), ...teams],
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
  validate('json', taskBody),
  async (c) => {
    const user = c.get('user')
    const projectId = c.req.param('id')
    const { assigneeIds, teamId: askedTeamId, ...data } = c.req.valid('json')

    // 404s for a project nobody can find and 409s for one that finished last semester,
    // before any permission is read — a lead of last term's build is owed the sentence
    // about the term rather than one about their rank.
    await requireCurrentProject(projectId)

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

/**
 * A task that belongs to a person rather than to a build.
 *
 * Its own route rather than a nullable `projectId` on the one above, because the two
 * are different acts with different refusals: that one 404s for a project nobody can
 * find, this one 403s for anybody who isn't an officer. One polymorphic route would
 * have to work out which sentence it owed.
 */
tasks.post(
  '/tasks',
  originGuard,
  requireAuth,
  writes,
  validate('json', directTaskBody),
  async (c) => {
    const user = c.get('user')
    const { assigneeIds, ...data } = c.req.valid('json')

    // Throws for anybody but an officer, and is the only place that rule is
    // written.
    await writingScope(user, null, null)
    await checkAssignees(null, assigneeIds)

    const task = await prisma.task.create({
      data: {
        ...data,
        projectId: null,
        teamId: null,
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
  validate('json', taskPatch),
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
  validate('json', z.object({ status: z.enum(TaskStatus) })),
  async (c) => {
    const user = c.get('user')
    const { status } = c.req.valid('json')

    const task = await getTask(c.req.param('id'))

    // Assignees may move their own work between labels; everyone else needs the write
    // scope. Deliberately the whole set rather than the three that read as progress:
    // somebody asked to do something is entitled to say it isn't going to happen, and
    // CANCELED on a row the lead can see is how they say it. A statement, not a
    // deletion — which is why cancelling is a label and not a DELETE.
    const assigned = await prisma.taskAssignee.findUnique({
      where: { taskId_userId: { taskId: task.id, userId: user.id } },
    })
    if (!assigned) await requireTaskManager(user, task)

    const updated = await prisma.task.update({
      where: { id: task.id },
      data:
        status === TaskStatus.DONE
          ? { status, completedById: user.id, completedAt: new Date() }
          : // Every other label clears the record, cancelling included — a task
            // that is open again was not completed by anyone, and one that was
            // called off was not completed either. Whatever happened last week,
            // the columns describe the row as it stands.
            { status, completedById: null, completedAt: null },
      select: taskSelect,
    })

    return c.json(wire(updated))
  },
)

/**
 * Putting a task on my own calendar, or taking it off again.
 *
 * The opt-in the dashboard calendar reads, per assignee: two people share "CAD the
 * chassis" and only one wants it in their week.
 *
 * `updateMany` on the composite key rather than a read and then a write, so there's one
 * query and one refusal. Somebody not on the task matches no rows and gets the 403 —
 * which is also why this doesn't call `getTask` first: a 404 there would answer a
 * question the caller has no business asking.
 */
tasks.post(
  '/tasks/:id/calendar',
  originGuard,
  requireAuth,
  writes,
  validate('json', z.object({ onCalendar: z.boolean() })),
  async (c) => {
    const taskId = c.req.param('id')
    const { onCalendar } = c.req.valid('json')

    const claim = await prisma.taskAssignee.updateMany({
      where: { taskId, userId: c.get('user').id },
      data: { onCalendar },
    })

    if (claim.count === 0) {
      throw new HTTPException(403, {
        message:
          'Only the person a task is assigned to can put it on their calendar.',
      })
    }

    const updated = await prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      select: taskSelect,
    })

    return c.json(wire(updated))
  },
)
