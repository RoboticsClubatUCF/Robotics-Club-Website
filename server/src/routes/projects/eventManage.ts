import { randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { validate, webUrl } from '../../core/validate.js'
import {
  isOfficer,
  requireCurrentDues,
  requireEventManager,
  requireProjectLead,
  requireTeamLead,
} from '../../auth/authz.js'
import { prisma } from '../../core/db.js'
import { EventType } from '../../generated/prisma/enums.js'
import { rateLimit } from '../../core/rateLimit.js'
import { type AuthEnv, originGuard, requireAuth } from '../../auth/session.js'

/**
 * Writing to the calendar. Reading stays where it was: the public list in `content.ts` (published
 * rows only, an invariant with its own test) and the member's own view in `me.ts`.
 *
 *   POST   /api/events      -> a project, team or club event (leads / officers)
 *   PATCH  /api/events/:id  -> edit  (creator, project lead over their teams, officers)
 *   DELETE /api/events/:id  -> same matrix
 *
 * Where an event hangs is what scopes the permission check, and there are three answers rather than
 * two: a team's lead, a project's lead, or — for a row belonging to no project — an officer. That
 * last case is what the events desk at `/dashboard/events` is largely for; the model always allowed
 * it and `requireEventManager` always handled it, but this router could not express it until now.
 *
 * `published` stays false unless an officer says otherwise, so the public calendar of events stays
 * officer-curated however many leads are scheduling things. Project meetings are the one deliberate
 * exception and do not come through here at all — they are three columns on `Project`, expanded by
 * `src/projects/meetings.ts` and gated by `meetingsPublic`, which is likewise an officer's switch.
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
  /**
   * Optional, and absent means club business — an officer-curated row with no project, which is
   * what the events desk is largely for.
   *
   * It used to be required, which made this router able to express only half of what the model
   * allowed: `Event.projectId` is nullable and `requireEventManager` has always had a branch for
   * the null case. The only rows that could reach it were ones seeded straight into Postgres.
   */
  projectId: z.uuid().optional(),
  teamId: z.uuid().nullable().optional(),
  /**
   * Where to sign up, when a thing needs signing up for. Read back by `managedEventSelect` and
   * printed by the calendar since before this router existed — it simply had no way in, so the only
   * rows carrying one were the seed's. An outreach event whose registration link can be read but
   * not set is a column nobody can use.
   */
  registrationUrl: webUrl().nullable().optional(),
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
  validate('json', eventBody),
  async (c) => {
    const user = c.get('user')
    const { projectId, teamId, published, ...data } = c.req.valid('json')

    checkOrder(data.startsAt, data.endsAt)
    checkPublish(published, isOfficer(user))

    // Which rank the event needs follows where it hangs: a team event takes
    // that team's lead, a project-wide one takes the project lead, and one
    // hanging off nothing at all is the club's own and takes an officer.
    if (teamId) {
      if (!projectId) {
        throw new HTTPException(400, {
          message: 'A team event has to name its project.',
        })
      }

      const team = await requireTeamLead(user, teamId)
      if (team.projectId !== projectId) {
        throw new HTTPException(400, {
          message: 'That team is not part of that project.',
        })
      }
    } else if (projectId) {
      await requireProjectLead(user, projectId)
    } else {
      // The mirror of `checkPublish`: the club's own calendar is the club's own
      // business. A lead may schedule anything they like on their project and
      // nothing at all on the club.
      if (!isOfficer(user)) {
        throw new HTTPException(403, {
          message: 'Only officers can create a club-wide event.',
        })
      }
      await requireCurrentDues(user)
    }

    if (
      projectId &&
      !(await prisma.project.findUnique({ where: { id: projectId } }))
    ) {
      throw new HTTPException(404, { message: 'No such project' })
    }

    const event = await prisma.event.create({
      data: {
        ...data,
        slug: slugFor(data.title),
        projectId: projectId ?? null,
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
  validate('json', eventPatch),
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
