import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { prisma } from '../db.js'
import {
  EventType,
  ProjectStatus,
  SponsorTier,
  UserRole,
} from '../generated/prisma/enums.js'
import type {
  EventSelect,
  PostSelect,
  ProjectSelect,
  UserSelect,
} from '../generated/prisma/models.js'

/**
 * Public, read-only content for the website. Everything here is reachable
 * without auth, so each query filters out unpublished rows and no select
 * reaches for a column the public shouldn't see.
 */
export const content = new Hono()

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

/**
 * Users and roster entries are the same table, so every public query has to say
 * which users are actually on the roster. A slug is what gives someone a public
 * profile URL, and GUEST is the signed-up-but-not-yet-anything default — an
 * account missing either has no business appearing on the site.
 */
const onRoster = { slug: { not: null }, role: { not: 'GUEST' } } as const

/** Contact details stay private — no `email` or `passwordHash` here. */
const rosterSelect = {
  id: true,
  slug: true,
  fullName: true,
  role: true,
  title: true,
  gradYear: true,
  bio: true,
  photoUrl: true,
  active: true,
  subteam: { select: { slug: true, name: true, color: true } },
} satisfies UserSelect

const projectSelect = {
  id: true,
  slug: true,
  title: true,
  summary: true,
  season: true,
  competition: true,
  status: true,
  coverUrl: true,
  repoUrl: true,
  featured: true,
  startedAt: true,
  completedAt: true,
} satisfies ProjectSelect

const eventSelect = {
  id: true,
  slug: true,
  title: true,
  description: true,
  type: true,
  location: true,
  startsAt: true,
  endsAt: true,
  registrationUrl: true,
} satisfies EventSelect

/** List view omits `body` so the payload stays small. */
const postListSelect = {
  id: true,
  slug: true,
  title: true,
  excerpt: true,
  coverUrl: true,
  publishedAt: true,
  author: { select: { fullName: true } },
} satisfies PostSelect

function notFound(what: string): never {
  throw new HTTPException(404, { message: `No such ${what}` })
}

/**
 * An event counts as past only once it has finished, so a multi-day competition
 * keeps showing as upcoming while it runs. Shared by the event listing and the
 * stats count so the two can never disagree about what "upcoming" means.
 */
const upcoming = (now: Date) => ({
  OR: [{ endsAt: { gte: now } }, { endsAt: null, startsAt: { gte: now } }],
})

const past = (now: Date) => ({
  OR: [{ endsAt: { lt: now } }, { endsAt: null, startsAt: { lt: now } }],
})

// -------------------------------------------------------------------- stats

/**
 * Counts for the landing page's headline strip.
 *
 * Each cell up there links to a listing page, so each count applies exactly the
 * filter that listing applies by default — the number you read is the number of
 * rows you find when you land. Change one and change the other. They run in a
 * transaction so the three numbers describe a single snapshot rather than three
 * separate moments, and `count` never loads the rows themselves.
 */
content.get('/stats', async (c) => {
  const now = new Date()

  const [projects, members, events] = await prisma.$transaction([
    // Matches GET /projects, which does not filter by status by default.
    prisma.project.count(),
    // Matches GET /members, which defaults to status=active.
    prisma.user.count({ where: { ...onRoster, active: true } }),
    // Matches GET /events, which defaults to when=upcoming.
    prisma.event.count({ where: { published: true, ...upcoming(now) } }),
  ])

  return c.json({ projects, members, events })
})

// ----------------------------------------------------------------- subteams

content.get('/subteams', async (c) => {
  const subteams = await prisma.subteam.findMany({
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      color: true,
      _count: { select: { members: { where: { active: true, ...onRoster } } } },
    },
  })

  return c.json(
    subteams.map(({ _count, ...subteam }) => ({
      ...subteam,
      memberCount: _count.members,
    })),
  )
})

// ------------------------------------------------------------------ members

content.get(
  '/members',
  zValidator(
    'query',
    listQuery.extend({
      subteam: z.string().optional(),
      role: z.enum(UserRole).optional(),
      /** Defaults to the current roster; `alumni` and `all` opt out of that. */
      status: z.enum(['active', 'alumni', 'all']).default('active'),
    }),
  ),
  async (c) => {
    const { subteam, role, status, limit, offset } = c.req.valid('query')

    const members = await prisma.user.findMany({
      where: {
        ...onRoster,
        ...(status === 'all' ? {} : { active: status === 'active' }),
        ...(subteam ? { subteam: { slug: subteam } } : {}),
        ...(role ? { role } : {}),
      },
      // Leadership first, then alphabetical — the order the team page wants.
      // UserRole is declared most permission to least, and Postgres sorts an
      // enum by declaration order, so ascending role is descending seniority.
      orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
      select: rosterSelect,
      take: limit,
      skip: offset,
    })

    return c.json(members)
  },
)

content.get('/members/:slug', async (c) => {
  const member = await prisma.user.findFirst({
    where: { ...onRoster, slug: c.req.param('slug') },
    select: {
      ...rosterSelect,
      joinedAt: true,
      projects: {
        select: {
          role: true,
          project: { select: { slug: true, title: true, season: true } },
        },
      },
    },
  })

  return member ? c.json(member) : notFound('member')
})

// ----------------------------------------------------------------- projects

content.get(
  '/projects',
  zValidator(
    'query',
    listQuery.extend({
      status: z.enum(ProjectStatus).optional(),
      season: z.string().optional(),
      featured: z.enum(['true', 'false']).optional(),
    }),
  ),
  async (c) => {
    const { status, season, featured, limit, offset } = c.req.valid('query')

    const projects = await prisma.project.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(season ? { season } : {}),
        ...(featured ? { featured: featured === 'true' } : {}),
      },
      orderBy: [{ featured: 'desc' }, { startedAt: 'desc' }, { title: 'asc' }],
      select: projectSelect,
      take: limit,
      skip: offset,
    })

    return c.json(projects)
  },
)

content.get('/projects/:slug', async (c) => {
  const project = await prisma.project.findUnique({
    where: { slug: c.req.param('slug') },
    select: {
      ...projectSelect,
      description: true,
      members: {
        select: {
          role: true,
          user: {
            select: { slug: true, fullName: true, photoUrl: true, title: true },
          },
        },
      },
    },
  })

  return project ? c.json(project) : notFound('project')
})

// ------------------------------------------------------------------- events

content.get(
  '/events',
  zValidator(
    'query',
    listQuery.extend({
      when: z.enum(['upcoming', 'past', 'all']).default('upcoming'),
      type: z.enum(EventType).optional(),
    }),
  ),
  async (c) => {
    const { when, type, limit, offset } = c.req.valid('query')
    const now = new Date()

    const timing =
      when === 'upcoming' ? upcoming(now) : when === 'past' ? past(now) : {}

    const events = await prisma.event.findMany({
      where: { published: true, ...timing, ...(type ? { type } : {}) },
      orderBy: { startsAt: when === 'past' ? 'desc' : 'asc' },
      select: eventSelect,
      take: limit,
      skip: offset,
    })

    return c.json(events)
  },
)

content.get('/events/:slug', async (c) => {
  const event = await prisma.event.findFirst({
    where: { slug: c.req.param('slug'), published: true },
    select: eventSelect,
  })

  return event ? c.json(event) : notFound('event')
})

// -------------------------------------------------------------------- posts

content.get('/posts', zValidator('query', listQuery), async (c) => {
  const { limit, offset } = c.req.valid('query')

  const posts = await prisma.post.findMany({
    // A null publishedAt is a draft; a future one is scheduled. Neither is public.
    where: { publishedAt: { not: null, lte: new Date() } },
    orderBy: { publishedAt: 'desc' },
    select: postListSelect,
    take: limit,
    skip: offset,
  })

  return c.json(posts)
})

content.get('/posts/:slug', async (c) => {
  const post = await prisma.post.findFirst({
    where: {
      slug: c.req.param('slug'),
      publishedAt: { not: null, lte: new Date() },
    },
    select: { ...postListSelect, body: true },
  })

  return post ? c.json(post) : notFound('post')
})

// ----------------------------------------------------------------- sponsors

content.get(
  '/sponsors',
  zValidator('query', z.object({ tier: z.enum(SponsorTier).optional() })),
  async (c) => {
    const { tier } = c.req.valid('query')

    const sponsors = await prisma.sponsor.findMany({
      where: { active: true, ...(tier ? { tier } : {}) },
      orderBy: [{ tier: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        tier: true,
        logoUrl: true,
        websiteUrl: true,
        blurb: true,
      },
    })

    return c.json(sponsors)
  },
)
