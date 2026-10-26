import type { MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requireProjectLead } from '../../auth/authz.js'
import type { AuthEnv } from '../../auth/session.js'
import { calendarRoutes } from '../../calendar/calendarRoutes.js'
import { prisma } from '../../core/db.js'
import { rateLimit } from '../../core/rateLimit.js'

/**
 * A project's Google Calendars, at `/api/projects/:projectId/google-calendars`, managed on the
 * project's manage page. Its lead and officers only. Imports belong to the project, and each
 * calendar says whether they also go on the public calendar. The routes are
 * `calendar/calendarRoutes.ts`.
 */
const projectLead: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const projectId = c.req.param('projectId') ?? ''
  // 404 before 403 for officers, who pass the lead check on any id; a calendar on a project that
  // isn't there would fail on its foreign key instead.
  if (!(await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } }))) {
    throw new HTTPException(404, { message: 'No such project' })
  }
  await requireProjectLead(c.get('user'), projectId)
  await next()
}

export const projectCalendars = calendarRoutes({
  authorize: projectLead,
  scopeOf: (c) => ({ projectId: c.req.param('projectId') ?? null }),
  writes: rateLimit('manage', 60),
})
