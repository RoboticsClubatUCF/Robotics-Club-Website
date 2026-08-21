import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { isOfficer } from '../authz.js'
import { prisma } from '../db.js'
import { allowanceFor } from '../printAllowance.js'
import { isCurrentTerm } from '../projectTerm.js'
import { currentTerm } from '../semester.js'
import { type AuthEnv, requireAuth } from '../session.js'
import { loanSelect } from './equipment.js'
import { managedProjectSelect } from './officer.js'
import { printSelect } from './print.js'

/**
 * The signed-in member's own view of the club — everything here is "mine".
 *
 *   GET /api/me/projects        -> my memberships: project, rank, team, term
 *   GET /api/me/events?from&to  -> the calendar as I see it
 *   GET /api/me/tasks           -> the open tasks with my name on them
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

    return c.json(events)
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

me.get('/tasks', requireAuth, async (c) => {
  const rows = await prisma.task.findMany({
    where: {
      status: 'OPEN',
      assignees: { some: { userId: c.get('user').id } },
    },
    orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    take: 50,
    select: {
      id: true,
      title: true,
      details: true,
      dueAt: true,
      status: true,
      project: { select: { slug: true, title: true } },
      team: { select: { name: true } },
    },
  })

  return c.json(rows)
})
