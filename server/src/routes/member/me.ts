import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { isOfficer } from '../../auth/authz.js'
import { prisma } from '../../core/db.js'
import {
  asMemberEvent,
  expandMeetings,
  meetingProjectSelect,
} from '../../projects/meetings.js'
import { allowanceFor } from '../../printing/printAllowance.js'
import { isCurrentTerm } from '../../projects/projectTerm.js'
import { currentTerm } from '../../membership/semester.js'
import { type AuthEnv, requireAuth } from '../../auth/session.js'
import { loanSelect } from './equipment.js'
import { managedProjectSelect } from '../officer/officer.js'
import { printSelect } from './print.js'
import {
  manageableTaskFilter,
  taskSelect,
  wire as wireTask,
} from '../projects/tasks.js'
import { TaskStatus } from '../../generated/prisma/enums.js'

/**
 * The signed-in member's own view of the club — everything here is "mine".
 *
 *   GET /api/me/projects        -> my memberships: project, rank, team, term
 *   GET /api/me/events?from&to  -> the calendar as I see it
 *   GET /api/me/tasks?scope&status -> my tasks, and the ones I run
 *   GET /api/me/print-requests  -> my 3D print requests, newest first
 *   GET /api/me/print-allowance -> grams left for my own prints this term
 *   GET /api/me/loans           -> what I have borrowed, and asked for
 *
 * Reads only, answered per-caller, so the router lives outside `publicApi`
 * with the other authenticated routes and nothing here is rate limited — the
 * dashboard calls these on every visit, the same deal `/dues/status` has.
 */
export const me = new Hono<AuthEnv>()

/**
 * Every membership, this term's and every term's, each one flagged.
 *
 * Filtered here it would be a smaller response and a worse one. The dashboard
 * reads this once for the whole section and hands it to the rail, the overview
 * and every project page under it — including a *past* project's manage page,
 * which resolves the project by finding its slug in this list. Dropping last
 * term's rows would take that page away from the lead who ran it.
 *
 * So the split is a flag, and the two audiences filter it in opposite
 * directions. It also costs nothing: the past-projects page needs no request of
 * its own.
 */
me.get('/projects', requireAuth, async (c) => {
  const [memberships, term] = await Promise.all([
    prisma.projectMember.findMany({
      where: { userId: c.get('user').id },
      orderBy: { project: { title: 'asc' } },
      select: {
        rank: true,
        title: true,
        team: { select: { id: true, name: true } },
        // The managed select rather than the public one: the dashboard prints
        // the meeting line, which public listings have no use for.
        project: { select: managedProjectSelect },
      },
    }),
    // Cached for a day per instance, so this is arithmetic rather than a read
    // of UCF's calendar on every dashboard load.
    currentTerm(),
  ])

  return c.json(
    memberships.map((membership) => ({
      ...membership,
      // Beside `rank`, not inside `project`. Everything in there is a column,
      // and a computed flag sitting among them is the thing somebody later
      // "tidies up" into the database — where it would be wrong for a
      // fortnight every August and need a sweep to fix.
      current: isCurrentTerm(membership.project, term),
    })),
  )
})

/**
 * The member's calendar: everything the public sees, plus the unpublished
 * events of the projects they are on. Officers see everything — theirs is the
 * desk the whole calendar answers to.
 *
 * The window semantics are the public route's exactly (overlap, half-open
 * `[from, to)`), so the same month grid can sit on either endpoint without
 * events shifting between the two.
 */
me.get(
  '/events',
  requireAuth,
  zValidator(
    'query',
    z.object({
      from: z.iso.datetime().optional(),
      to: z.iso.datetime().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(200),
    }),
  ),
  async (c) => {
    const user = c.get('user')
    const { from, to, limit } = c.req.valid('query')

    const events = await prisma.event.findMany({
      where: {
        AND: [
          ...(from
            ? [
                {
                  OR: [
                    { endsAt: { gte: new Date(from) } },
                    { endsAt: null, startsAt: { gte: new Date(from) } },
                  ],
                },
              ]
            : []),
          ...(isOfficer(user)
            ? []
            : [
                {
                  OR: [
                    { published: true },
                    { project: { members: { some: { userId: user.id } } } },
                  ],
                },
              ]),
        ],
        ...(to ? { startsAt: { lt: new Date(to) } } : {}),
      },
      orderBy: { startsAt: 'asc' },
      take: limit,
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        type: true,
        location: true,
        startsAt: true,
        endsAt: true,
        allDay: true,
        registrationUrl: true,
        published: true,
        projectId: true,
        teamId: true,
        createdById: true,
        project: { select: { slug: true, title: true } },
        team: { select: { name: true } },
      },
    })

    if (!from || !to) return c.json(events)

    /**
     * The meetings this person should see, on the same rule the stored rows
     * above follow: everything public, plus everything on a project of theirs.
     *
     * The union is what stops the two calendars disagreeing. A public project's
     * meeting has to read the same on the front page and on the dashboard, and
     * a member's own project has to show its meetings whether or not an officer
     * has put that project on the front page.
     *
     * Officers are *not* given every project's meetings here, unlike the stored
     * rows. Those they see because publishing is their decision and an
     * unpublished event is a thing awaiting it; a meeting on a project switched
     * off the public calendar is a settled answer, not a queue, and forty
     * projects' Tuesdays would bury their own.
     */
    const projects = await prisma.project.findMany({
      where: {
        meetingWeekdays: { isEmpty: false },
        OR: [
          { meetingsPublic: true },
          { members: { some: { userId: user.id } } },
        ],
      },
      select: meetingProjectSelect,
    })

    const meetings = (
      await expandMeetings(projects, new Date(from), new Date(to))
    ).map(asMemberEvent)

    /**
     * The third source: deadlines this person asked to see.
     *
     * **Opted in, one at a time, and never anybody else's.** The filter is on
     * `onCalendar` *inside* the assignee match, so it is this caller's own row
     * of the join table that decides — a task two people share appears for
     * whichever of them asked for it. Nothing here reaches the public
     * `/api/events`, which does not read `tasks` at all.
     *
     * Settled work is left out for the same reason a done task drops off the
     * overview: a calendar is what is ahead of you, and a deadline you already
     * met is not a thing to plan around.
     */
    const dueTasks = await prisma.task.findMany({
      where: {
        // The same half-open window the stored rows and the meetings use, so a
        // deadline at midnight on the 1st belongs to the month that is
        // starting rather than to both.
        dueAt: { gte: new Date(from), lt: new Date(to) },
        status: { notIn: [TaskStatus.DONE, TaskStatus.CANCELED] },
        assignees: { some: { userId: user.id, onCalendar: true } },
      },
      select: {
        id: true,
        title: true,
        details: true,
        dueAt: true,
        status: true,
        projectId: true,
        teamId: true,
        project: { select: { slug: true, title: true } },
        team: { select: { name: true } },
      },
    })

    const taskEntries = dueTasks.map((task) => ({
      // The `meeting:` prefix convention. There is no row a calendar could
      // `PATCH` behind one of these — the task is the row — so the id says so
      // and `web/src/lib/events/events.ts` reads it to keep the edit controls
      // off them.
      id: `task:${task.id}`,
      slug: `task:${task.id}`,
      // Named as a deadline rather than as an event, because that is what it
      // is: "Due: cut the brackets" reads correctly in a week view, and the
      // bare title reads as a meeting somebody scheduled.
      title: `Due: ${task.title}`,
      description: task.details,
      type: 'TASK' as const,
      location: null,
      startsAt: task.dueAt!.toISOString(),
      endsAt: null,
      allDay: false,
      registrationUrl: null,
      // Never public, and there is no switch that would make one public.
      published: false,
      projectId: task.projectId,
      teamId: task.teamId,
      // Nobody created this. It is a projection of a task, the way a meeting is
      // a projection of a schedule — and a name here would be one the calendar
      // then offers to edit.
      createdById: null,
      project: task.project,
      team: task.team,
      // What the row needs to link back to the tasks page and print its label,
      // carried on the entry the way `meeting` carries its series.
      task: { id: task.id, status: task.status },
    }))

    return c.json(
      [...events, ...meetings, ...taskEntries].sort(
        (a, b) =>
          new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
      ),
    )
  },
)

/**
 * My open assignments across every project, nearest deadline first. Done work
 * stays off this list — the overview card is "what do I owe people", and the
 * full board with its history lives on the project's own tasks view.
 */
/**
 * My print requests, settled ones included — `fileName`/`fileSize` survive
 * the file's deletion, so the history stays readable after the bytes go.
 * `fileId` is null once a job settles, which is how the page knows to stop
 * offering the download.
 */
me.get('/print-requests', requireAuth, async (c) => {
  const requests = await prisma.printRequest.findMany({
    where: { userId: c.get('user').id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: printSelect,
  })

  return c.json(requests)
})

/**
 * What I have left to print with this term.
 *
 * Its own endpoint rather than a field on the list above, because the two
 * answer different questions and change at different moments: the list is
 * history, this is a budget, and the page reloads this after every submission
 * while the list is what the submission appends to.
 *
 * Not dues-gated, unlike the print router itself. Somebody whose dues have
 * lapsed cannot submit anything, but "how much do I have left" is worth being
 * able to read on the way to paying — and it is their own number.
 */
me.get('/print-allowance', requireAuth, async (c) => {
  return c.json(await allowanceFor(c.get('user').id))
})

/** My borrowing, live asks and history together, newest first. */
me.get('/loans', requireAuth, async (c) => {
  const loans = await prisma.equipmentLoan.findMany({
    where: { userId: c.get('user').id },
    orderBy: { requestedAt: 'desc' },
    take: 50,
    select: loanSelect,
  })

  return c.json(loans)
})

/**
 * Tasks, from either end: the ones with my name on them and the ones I run.
 *
 * One endpoint rather than two, because they are the same rows read through
 * two filters and a lead's page wants them merged. The scoping half is
 * `manageableTaskFilter` in `routes/projects/tasks.ts`, imported rather than
 * restated — that file owns who may touch what, and a second copy of the rule
 * here is how the two would come to disagree.
 *
 * `status=open` is the default and means **not DONE and not CANCELED**, which
 * is what "open" has meant since the labels grew past two. The overview card
 * takes the defaults and gets exactly what it always got, plus the work
 * somebody has started or flagged as slipping — which is still work they owe.
 */
me.get(
  '/tasks',
  requireAuth,
  zValidator(
    'query',
    z.object({
      scope: z.enum(['mine', 'managed', 'all']).default('mine'),
      status: z.enum(['open', 'all']).default('open'),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
  ),
  async (c) => {
    const user = c.get('user')
    const { scope, status, limit } = c.req.valid('query')

    const mine = { assignees: { some: { userId: user.id } } }
    const managed = scope === 'mine' ? null : await manageableTaskFilter(user)

    const whose =
      managed === null
        ? mine
        : scope === 'managed'
          ? managed
          : { OR: [mine, managed] }

    const rows = await prisma.task.findMany({
      where: {
        ...whose,
        ...(status === 'open'
          ? { status: { notIn: [TaskStatus.DONE, TaskStatus.CANCELED] } }
          : {}),
      },
      // Two orders, because the two lists answer different questions. With
      // nothing settled in the list the question is "what is due", so the
      // deadline leads; with everything in it the question is "where does this
      // all stand", and grouping by label is what makes that readable. The
      // enum's declaration order is what makes the second one come out with
      // open work on top — see `TaskStatus` in `schema.prisma`.
      orderBy:
        status === 'open'
          ? [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }]
          : [
              { status: 'asc' },
              { dueAt: { sort: 'asc', nulls: 'last' } },
              { createdAt: 'desc' },
            ],
      take: limit,
      select: taskSelect,
    })

    return c.json(rows.map(wireTask))
  },
)
