import { randomBytes, scryptSync } from 'node:crypto'
import { prisma } from '../src/db.js'

/**
 * Placeholder content so the site has something to render in development.
 * Everything here is upserted on a unique key, so re-running is safe.
 */

/** scrypt from the stdlib, so seeding needs no extra dependency. */
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`
}

const subteams = [
  { slug: 'software', name: 'Software', color: '#4f8cff', sortOrder: 1 },
  { slug: 'mechanical', name: 'Mechanical', color: '#ff8a4f', sortOrder: 2 },
  { slug: 'electrical', name: 'Electrical', color: '#ffd24f', sortOrder: 3 },
  { slug: 'outreach', name: 'Outreach', color: '#5fd08a', sortOrder: 4 },
  { slug: 'business', name: 'Business', color: '#b47fff', sortOrder: 5 },
]

/**
 * The public roster: users with a slug. One of each role, so the ordering the
 * team page depends on is visible in development.
 */
const members = [
  {
    slug: 'alex-chen',
    fullName: 'Alex Chen',
    role: 'OFFICER' as const,
    title: 'Team Captain',
    gradYear: 2027,
    active: true,
    subteam: 'software',
  },
  {
    slug: 'priya-raman',
    fullName: 'Priya Raman',
    role: 'TEAM_LEAD' as const,
    title: 'Software Lead',
    gradYear: 2027,
    active: true,
    subteam: 'software',
  },
  {
    slug: 'sam-okafor',
    fullName: 'Sam Okafor',
    role: 'TEAM_LEAD' as const,
    title: 'Mechanical Lead',
    gradYear: 2026,
    active: true,
    subteam: 'mechanical',
  },
  {
    slug: 'mateo-ruiz',
    fullName: 'Mateo Ruiz',
    role: 'PROJECT_LEAD' as const,
    title: 'Vision Stack Lead',
    gradYear: 2026,
    active: true,
    subteam: 'software',
  },
  {
    slug: 'jordan-lee',
    fullName: 'Jordan Lee',
    role: 'MEMBER' as const,
    title: null,
    gradYear: 2028,
    active: true,
    subteam: 'electrical',
  },
  {
    slug: 'dana-whitfield',
    fullName: 'Dana Whitfield',
    role: 'MENTOR' as const,
    title: 'Faculty Mentor',
    gradYear: null,
    active: true,
    subteam: null,
  },
  {
    slug: 'rae-lindqvist',
    fullName: 'Rae Lindqvist',
    role: 'ALUMNUS' as const,
    title: 'Captain, 2023-2024',
    gradYear: 2025,
    // Inactive is what `?status=alumni` filters on; the role is the label.
    active: false,
    subteam: null,
  },
]

/**
 * The club's actual competition projects — these are real, unlike the people
 * above, which is why none of them carry `leads`: linking real projects to
 * placeholder members would invent a roster that doesn't exist. Assign leads in
 * Prisma Studio once the real members are in.
 *
 * Order here is not display order. `GET /api/projects` sorts featured first,
 * then newest by `startedAt`, then by title — and none of these set
 * `startedAt`, so the two featured ones lead and the rest fall alphabetical.
 * Set `startedAt` if the landing page ever needs a specific order.
 */
const projects = [
  {
    slug: 'sumobots-2026',
    title: 'SumoBots 2026',
    competition: 'COMBAT · WITH ASME @ UCF',
    summary:
      'Design and build a robot whose only job is to shove other robots out of the ring. Fast build cycle, immediate feedback.',
    season: 'Spring 2026',
    status: 'IN_PROGRESS' as const,
    featured: true,
    leads: [] as string[],
  },
  {
    slug: 'project-storm',
    title: 'Project S.T.O.R.M.',
    competition: 'UNIVERSITY ROVER CHALLENGE',
    summary:
      'Research, design, build and test a Mars rover, then run it against teams from around the world in the Utah desert.',
    season: 'June 2026',
    status: 'IN_PROGRESS' as const,
    featured: true,
    leads: [] as string[],
  },
  {
    slug: 'pep26',
    title: 'PEP26',
    competition: 'PROMOTION OF ELECTRIC PROPULSION',
    summary:
      'An electric boat built to finish a two-mile course as fast as possible. Powertrain, hull, and telemetry.',
    season: 'Apr 2026',
    status: 'IN_PROGRESS' as const,
    featured: false,
    leads: [] as string[],
  },
  {
    slug: 'knightmare',
    title: 'Knightmare',
    competition: 'VEX U ROBOTICS COMPETITION',
    summary:
      'A 15" and a 24" robot scoring rings and elevating robots in High Stakes — designed, programmed and driven in-house.',
    season: 'Season-long',
    status: 'IN_PROGRESS' as const,
    featured: false,
    leads: [] as string[],
  },
  {
    slug: 'tapemeasure',
    title: 'TapeMeasure',
    competition: 'BOSTON DYNAMICS SPOT',
    summary:
      'Work on and around our own Spot robot. Outreach demos, real work experience, and a lot of fun.',
    season: 'Year-round',
    status: 'IN_PROGRESS' as const,
    featured: false,
    leads: [] as string[],
  },
]

const day = 24 * 60 * 60 * 1000
const now = Date.now()

const events = [
  {
    slug: 'weekly-build-night',
    title: 'Weekly Build Night',
    type: 'MEETING' as const,
    location: 'Engineering Lab, Room 114',
    startsAt: new Date(now + 3 * day),
    endsAt: new Date(now + 3 * day + 3 * 60 * 60 * 1000),
    published: true,
  },
  {
    slug: 'regional-qualifier',
    title: 'Regional Qualifier',
    type: 'COMPETITION' as const,
    location: 'City Convention Center',
    startsAt: new Date(now + 30 * day),
    endsAt: new Date(now + 32 * day),
    published: true,
  },
  {
    slug: 'intro-to-cad-workshop',
    title: 'Intro to CAD Workshop',
    type: 'WORKSHOP' as const,
    location: 'Engineering Lab, Room 114',
    startsAt: new Date(now + 10 * day),
    endsAt: new Date(now + 10 * day + 2 * 60 * 60 * 1000),
    published: false,
  },
]

const sponsors = [
  { name: 'Northgate Manufacturing', tier: 'PLATINUM' as const },
  { name: 'Halden Robotics Supply', tier: 'GOLD' as const },
  { name: 'Cedar Valley Engineering', tier: 'SILVER' as const },
  { name: 'Local Makerspace', tier: 'PARTNER' as const },
]

async function main() {
  // No slug: a login that isn't a roster entry, so nothing public lists it.
  const admin = await prisma.user.upsert({
    where: { email: 'admin@rccf.local' },
    update: {},
    create: {
      email: 'admin@rccf.local',
      fullName: 'Site Admin',
      passwordHash: hashPassword(process.env.SEED_ADMIN_PASSWORD ?? 'changeme'),
      role: 'ADMIN',
    },
  })

  // The other half of that: no slug, no password, and the default GUEST role —
  // what someone who has only signed up looks like.
  await prisma.user.upsert({
    where: { email: 'guest@rccf.local' },
    update: {},
    create: { email: 'guest@rccf.local', fullName: 'Prospective Member' },
  })

  for (const subteam of subteams) {
    await prisma.subteam.upsert({
      where: { slug: subteam.slug },
      update: subteam,
      create: subteam,
    })
  }

  for (const { subteam, ...member } of members) {
    const data = {
      ...member,
      subteam: subteam ? { connect: { slug: subteam } } : undefined,
    }
    await prisma.user.upsert({
      where: { slug: member.slug },
      update: data,
      create: data,
    })
  }

  // Upsert only: deleting a project from the array above will not remove it
  // from a database that already has it. Delete those by hand, or in Studio.
  for (const { leads, ...project } of projects) {
    await prisma.project.upsert({
      where: { slug: project.slug },
      update: project,
      create: project,
    })

    for (const slug of leads) {
      const user = await prisma.user.findUniqueOrThrow({ where: { slug } })
      const created = await prisma.project.findUniqueOrThrow({
        where: { slug: project.slug },
      })
      await prisma.projectMember.upsert({
        where: {
          projectId_userId: { projectId: created.id, userId: user.id },
        },
        update: { role: 'Lead' },
        create: { projectId: created.id, userId: user.id, role: 'Lead' },
      })
    }
  }

  for (const event of events) {
    await prisma.event.upsert({
      where: { slug: event.slug },
      update: event,
      create: event,
    })
  }

  for (const sponsor of sponsors) {
    await prisma.sponsor.upsert({
      where: { name: sponsor.name },
      update: sponsor,
      create: sponsor,
    })
  }

  await prisma.post.upsert({
    where: { slug: 'kickoff-2026' },
    update: {},
    create: {
      slug: 'kickoff-2026',
      title: 'Season kickoff is here',
      excerpt: 'The 2026 game has been revealed and the build clock is running.',
      body: 'Placeholder post body. Replace from the admin once the CMS exists.',
      publishedAt: new Date(now - 7 * day),
      authorId: admin.id,
    },
  })

  const counts = {
    users: await prisma.user.count(),
    // Everyone with a slug — the subset the public roster shows.
    roster: await prisma.user.count({ where: { slug: { not: null } } }),
    subteams: await prisma.subteam.count(),
    projects: await prisma.project.count(),
    events: await prisma.event.count(),
    sponsors: await prisma.sponsor.count(),
    posts: await prisma.post.count(),
  }
  console.log('Seeded:', counts)
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
