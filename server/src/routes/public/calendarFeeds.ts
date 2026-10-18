import { Hono, type Context } from 'hono'
import { prisma } from '../../core/db.js'
import { UserRole } from '../../generated/prisma/enums.js'
import {
  clubFeed,
  FEED_TOKEN,
  officersFeed,
  projectFeed,
} from '../../calendar/feeds.js'
import { meetingProjectSelect } from '../../projects/meetings.js'

/**
 * Calendar subscriptions, for Google, Apple and Outlook to poll.
 *
 *   GET /api/calendar/club.ics                    -> the public calendar
 *   GET /api/calendar/:token/projects/:slug.ics   -> one project, for its members
 *   GET /api/calendar/:token/officers.ics         -> unpublished club-wide events, for officers
 *
 * A calendar app can't sign in, so the private feeds carry the person's token in the path
 * (`calendar_feeds`). Who the token belongs to is checked against their current projects and
 * role on every read. Anything that doesn't resolve is a plain 404, the same for a bad token
 * and a project somebody has left.
 */
export const calendarFeeds = new Hono()

function ics(c: Context, body: string, cache: string) {
  return c.body(body, 200, {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Cache-Control': cache,
  })
}

const notFound = (c: Context) =>
  c.text('Not found', 404, { 'Cache-Control': 'no-store' })

/** Five minutes, short against how often anything polls, and shared caches may keep it. */
const PUBLIC = 'public, max-age=300, s-maxage=300'
/** A private feed is one person's, so no shared cache may hold it. */
const PRIVATE = 'private, max-age=300'

calendarFeeds.get('/club.ics', async (c) => ics(c, await clubFeed(), PUBLIC))

async function holder(token: string) {
  if (!FEED_TOKEN.test(token)) return null

  const feed = await prisma.calendarFeed.findUnique({
    where: { token },
    select: { user: { select: { id: true, role: true } } },
  })
  return feed?.user ?? null
}

const officer = (role: UserRole) =>
  role === UserRole.OFFICER || role === UserRole.ADMIN

calendarFeeds.get('/:token/officers.ics', async (c) => {
  const user = await holder(c.req.param('token'))
  if (!user || !officer(user.role)) return notFound(c)

  return ics(c, await officersFeed(), PRIVATE)
})

calendarFeeds.get('/:token/projects/:file', async (c) => {
  const file = c.req.param('file')
  if (!file.endsWith('.ics')) return notFound(c)

  const user = await holder(c.req.param('token'))
  if (!user) return notFound(c)

  // Officers see every project's events on their dashboard, so they may subscribe to any of
  // them; everybody else needs a membership row.
  const project = await prisma.project.findFirst({
    where: {
      slug: file.slice(0, -'.ics'.length),
      ...(officer(user.role)
        ? {}
        : { members: { some: { userId: user.id } } }),
    },
    select: meetingProjectSelect,
  })
  if (!project) return notFound(c)

  return ics(c, await projectFeed(project), PRIVATE)
})
