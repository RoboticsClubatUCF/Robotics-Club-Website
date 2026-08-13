import { randomBytes } from 'node:crypto'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import {
  isOfficer,
  requireEventManager,
  requireProjectLead,
  requireTeamLead,
} from '../authz.js'
import { prisma } from '../db.js'
import { EventType } from '../generated/prisma/enums.js'
import { rateLimit } from '../rateLimit.js'
import { type AuthEnv, originGuard, requireAuth } from '../session.js'

/**
 * Writing to the calendar. Reading stays where it was: the public list in
 * `content.ts` (published rows only, an invariant with its own test) and the
 * member's own view in `me.ts`.
 *
 *   POST   /api/events      -> a project or team event (leads)
 *   PATCH  /api/events/:id  -> edit  (creator, project lead over their teams, officers)
 *   DELETE /api/events/:id  -> same matrix
 *
 * Everything created here belongs to a project — that is what scopes the
 * permission check, and what scopes who sees it. `published` stays false
 * unless an officer says otherwise, so the public site's calendar remains
 * entirely officer-curated no matter how many leads are scheduling meetings.
 */
export const eventManage = new Hono<AuthEnv>()

/** Sized for a lead laying out a term's worth of meetings in one sitting. */
const writes = rateLimit('events', 30)

/**
 * Slugs are generated, not chosen: they exist because the Event model demands
 * uniqueness for the public site's URLs, and asking a lead to invent one for
 * every weekly meeting is busywork with a 409 waiting at the end. Four random
 * bytes make "kickoff" and next term's "kickoff" coexist.
 */
const slugFor = (title: string) => {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'event'
  return `${base}-${randomBytes(4).toString('hex')}`
}

const eventBody = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(5_000).nullable().optional(),
  type: z.enum(EventType).default(EventType.MEETING),
  location: z.string().trim().max(160).nullable().optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().nullable().optional(),
  allDay: z.boolean().default(false),
  projectId: z.uuid(),
  teamId: z.uuid().nullable().optional(),
  published: z.boolean().optional(),
})

const managedEventSelect = {
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
} as const

function checkOrder(startsAt: Date, endsAt: Date | null | undefined) {
  if (endsAt && endsAt <= startsAt) {
    throw new HTTPException(400, {
      message: 'An event has to end after it starts.',
    })
  }
}

/** The publish switch is the public site, and the public site is officer-run. */
function checkPublish(published: boolean | undefined, officer: boolean) {
  if (published !== undefined && !officer) {
    throw new HTTPException(403, {
      message: 'Only officers can put events on the public calendar.',
    })
  }
}

eventManage.post(
  '/',
  originGuard,
  requireAuth,
  writes,
  zValidator('json', eventBody),
  async (c) => {
    const user = c.get('user')
    const { projectId, teamId, published, ...data } = c.req.valid('json')

    checkOrder(data.startsAt, data.endsAt)
    checkPublish(published, isOfficer(user))

    // Which rank the event needs follows where it hangs: a team event takes
    // that team's lead, a project-wide one takes the project lead.
    if (teamId) {
      const team = await requireTeamLead(user, teamId)
      if (team.projectId !== projectId) {
        throw new HTTPException(400, {
          message: 'That team is not part of that project.',
        })
      }
    } else {
      await requireProjectLead(user, projectId)
    }

    if (!(await prisma.project.findUnique({ where: { id: projectId } }))) {
      throw new HTTPException(404, { message: 'No such project' })
    }

    const event = await prisma.event.create({
      data: {
        ...data,
        slug: slugFor(data.title),
        projectId,
        teamId: teamId ?? null,
        published: published ?? false,
        createdById: user.id,
      },
      select: managedEventSelect,
    })

    return c.json(event, 201)
  },
)

/**
 * Edits keep the event where it is: no `projectId`/`teamId` here. Moving an
 * event between teams is deleting and recreating it, which keeps the
 * permission question one-dimensional.
 */
const eventPatch = eventBody.omit({ projectId: true, teamId: true }).partial()

eventManage.patch(
  '/:id',
  originGuard,
  requireAuth,
  writes,
  zValidator('json', eventPatch),
  async (c) => {
    const user = c.get('user')
    const patch = c.req.valid('json')

    const event = await prisma.event.findUnique({
      where: { id: c.req.param('id') },
    })
    if (!event) throw new HTTPException(404, { message: 'No such event' })

    await requireEventManager(user, event)
    checkPublish(patch.published, isOfficer(user))
    // The ordering rule holds on the *resulting* row, whichever half changed.
    checkOrder(
      patch.startsAt ?? event.startsAt,
      patch.endsAt === undefined ? event.endsAt : patch.endsAt,
    )

    const updated = await prisma.event.update({
      where: { id: event.id },
      data: patch,
      select: managedEventSelect,
    })

    return c.json(updated)
  },
)

eventManage.delete('/:id', originGuard, requireAuth, writes, async (c) => {
  const user = c.get('user')

  const event = await prisma.event.findUnique({
    where: { id: c.req.param('id') },
  })
  if (!event) throw new HTTPException(404, { message: 'No such event' })

  await requireEventManager(user, event)
  await prisma.event.delete({ where: { id: event.id } })

  return c.json({ deleted: true })
})
