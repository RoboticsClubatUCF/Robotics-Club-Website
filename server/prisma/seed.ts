import { prisma } from '../src/db.js'
import { hashPassword } from '../src/password.js'

/**
 * Placeholder content so the site has something to render in development.
 * Everything here is upserted on a unique key, so re-running is safe.
 */

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
 * The officer board, one placeholder person per seat.
 *
 * Every name here is invented — replace them in Prisma Studio before this goes
 * anywhere public, because the landing page prints these under the club's real
 * office titles and a fake president reads as a real one.
 *
 * `officerPosition` is the seat and drives which card someone lands in; `title`
 * is only the label printed on it, so an "Interim President" can say so without
 * falling out of the president's card. The advisor is a `MENTOR` rather than an
 * `OFFICER` — they sit on the board but hold no student office, which is the
 * whole reason the seat is a separate field from the role.
 */
const officers = [
  {
    slug: 'placeholder-president',
    fullName: 'Jordan Ellis',
    officerPosition: 'PRESIDENT' as const,
    title: 'President',
    role: 'OFFICER' as const,
    bio: 'Placeholder officer. Replace before this is public.',
    gradYear: 2027,
    subteam: 'mechanical',
  },
  {
    slug: 'placeholder-vice-president',
    fullName: 'Nia Barrett',
    officerPosition: 'VICE_PRESIDENT' as const,
    title: 'Vice President',
    role: 'OFFICER' as const,
    bio: 'Placeholder officer. Replace before this is public.',
    gradYear: 2027,
    subteam: 'electrical',
  },
  {
    slug: 'placeholder-treasurer',
    fullName: 'Owen Castellanos',
    officerPosition: 'TREASURER' as const,
    title: 'Treasurer',
    role: 'OFFICER' as const,
    bio: 'Placeholder officer. Replace before this is public.',
    gradYear: 2026,
    subteam: 'business',
  },
  {
    slug: 'placeholder-secretary',
    fullName: 'Harper Nakamura',
    officerPosition: 'SECRETARY' as const,
    title: 'Secretary',
    role: 'OFFICER' as const,
    bio: 'Placeholder officer. Replace before this is public.',
    gradYear: 2028,
    subteam: 'business',
  },
  {
    slug: 'placeholder-marketing',
    fullName: 'Devin Osei',
    officerPosition: 'MARKETING' as const,
    title: 'Marketing',
    role: 'OFFICER' as const,
    bio: 'Placeholder officer. Replace before this is public.',
    gradYear: 2027,
    subteam: 'business',
  },
  {
    slug: 'placeholder-outreach',
    fullName: 'Simone Alvarez',
    officerPosition: 'OUTREACH' as const,
    title: 'Outreach',
    role: 'OFFICER' as const,
    bio: 'Placeholder officer. Replace before this is public.',
    gradYear: 2026,
    subteam: 'outreach',
  },
  {
    slug: 'placeholder-lab-manager',
    fullName: 'Reid Ferguson',
    officerPosition: 'LAB_MANAGER' as const,
    title: 'Lab Manager',
    role: 'OFFICER' as const,
    bio: 'Placeholder officer. Replace before this is public.',
    gradYear: 2026,
    subteam: 'mechanical',
  },
  {
    slug: 'placeholder-faculty-advisor',
    fullName: 'Dr. Alina Petrov',
    officerPosition: 'FACULTY_ADVISOR' as const,
    title: 'Faculty Advisor',
    role: 'MENTOR' as const,
    bio: 'Placeholder advisor. Replace before this is public.',
    gradYear: null,
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
const today = new Date()

/** The club's own room, which most of the calendar happens in. */
const lab = 'Institute for Simulation & Training, 3100 Technology Pkwy'

/**
 * The `n`th `weekday` (0 = Sunday) of the month `monthOffset` months from now,
 * at local `hour:minute`.
 *
 * The calendar is the point of these, so they are pinned to weekdays of the
 * current month rather than to fixed dates: a hard-coded August would leave the
 * grid empty from September on, and relative day offsets would scatter the
 * meetings across arbitrary weekdays. `n` stays at 4 or below, which is the most
 * a month is guaranteed to have — a 5th would silently roll into the next one.
 */
function nthWeekday(
  monthOffset: number,
  weekday: number,
  n: number,
  hour: number,
  minute = 0,
): Date {
  const first = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1)
  const shift = (weekday - first.getDay() + 7) % 7
  return new Date(
    first.getFullYear(),
    first.getMonth(),
    1 + shift + (n - 1) * 7,
    hour,
    minute,
  )
}

const hoursAfter = (start: Date, hours: number) =>
  new Date(start.getTime() + hours * 60 * 60 * 1000)

/** End of the day `days` after `start` — the closing edge of an all-day span. */
const endOfDayAfter = (start: Date, days: number) =>
  new Date(start.getFullYear(), start.getMonth(), start.getDate() + days, 23, 59)

const WED = 3
const TUE = 2
const THU = 4
const FRI = 5
const SAT = 6

/**
 * Slugs are fixed while the dates are computed, so re-seeding moves these rows
 * onto the current month instead of piling up a new set beside the old one.
 *
 * There is no recurrence model, so the every-other-week general body meeting is
 * four separate rows. If the club ever wants a real repeating event, that is a
 * `recurrenceRule` on `Event` plus expansion in the route — not more rows here.
 */
const events = [
  {
    slug: 'gbm-first',
    title: 'General Body Meeting',
    description:
      'Club-wide meeting: what every project is working on this cycle, and how to get onto one.',
    type: 'MEETING' as const,
    location: lab,
    startsAt: nthWeekday(0, WED, 1, 18, 30),
    published: true,
  },
  {
    slug: 'build-night-second',
    title: 'Open Build Night',
    description: 'Lab open, projects running. Drop in and work on something.',
    type: 'MEETING' as const,
    location: lab,
    startsAt: nthWeekday(0, WED, 2, 18, 0),
    published: true,
  },
  {
    slug: 'gbm-third',
    title: 'General Body Meeting',
    description:
      'Club-wide meeting: what every project is working on this cycle, and how to get onto one.',
    type: 'MEETING' as const,
    location: lab,
    startsAt: nthWeekday(0, WED, 3, 18, 30),
    published: true,
  },
  {
    slug: 'build-night-fourth',
    title: 'Open Build Night',
    description: 'Lab open, projects running. Drop in and work on something.',
    type: 'MEETING' as const,
    location: lab,
    startsAt: nthWeekday(0, WED, 4, 18, 0),
    published: true,
  },
  {
    slug: 'semester-kickoff-social',
    title: 'Semester Kickoff Social',
    description: 'Meet the officers and the project leads. Food provided.',
    type: 'SOCIAL' as const,
    location: lab,
    startsAt: nthWeekday(0, FRI, 1, 19, 0),
    published: true,
  },
  {
    slug: 'intro-to-cad-workshop',
    title: 'Intro to CAD Workshop',
    description:
      'Onshape from nothing to a printable part. No experience needed, bring a laptop.',
    type: 'WORKSHOP' as const,
    location: lab,
    startsAt: nthWeekday(0, TUE, 2, 19, 0),
    published: true,
  },
  {
    slug: 'soldering-101',
    title: 'Soldering 101',
    description: 'Through-hole and surface mount, on scrap boards. Irons provided.',
    type: 'WORKSHOP' as const,
    location: lab,
    startsAt: nthWeekday(0, THU, 3, 19, 0),
    published: true,
  },
  {
    slug: 'stem-saturday-outreach',
    title: 'STEM Saturday',
    description:
      'Demo day for local middle schoolers. Volunteers wanted — Spot always draws a crowd.',
    type: 'OUTREACH' as const,
    location: 'Orlando Science Center',
    startsAt: nthWeekday(0, SAT, 3, 0, 0),
    allDay: true,
    published: true,
  },
  {
    slug: 'sumo-bot-scrimmage',
    title: 'SumoBot Scrimmage',
    description: 'Open bracket against ASME. Bring a bot or come to watch.',
    type: 'COMPETITION' as const,
    location: lab,
    startsAt: nthWeekday(0, SAT, 4, 10, 0),
    published: true,
  },
  {
    slug: 'sponsor-showcase-night',
    title: 'Sponsor Showcase Night',
    description:
      'Projects present to the people funding them. Business casual, and the rover runs.',
    type: 'FUNDRAISER' as const,
    location: lab,
    startsAt: nthWeekday(1, WED, 2, 18, 0),
    published: true,
  },
  {
    slug: 'university-rover-challenge',
    title: 'University Rover Challenge',
    description: 'Field competition in the Utah desert. Four days, one rover.',
    type: 'COMPETITION' as const,
    location: 'Mars Desert Research Station, Hanksville, UT',
    startsAt: nthWeekday(1, THU, 2, 0, 0),
    allDay: true,
    registrationUrl: 'https://urc.marssociety.org/',
    published: true,
  },
  // Kept unpublished so `hides unpublished events` in content.test.ts has
  // something to prove, and so the calendar can be checked for leaks by eye.
  {
    slug: 'officer-planning-retreat',
    title: 'Officer Planning Retreat',
    description: 'Board-only. Not for the public calendar.',
    type: 'MEETING' as const,
    location: lab,
    startsAt: nthWeekday(0, SAT, 2, 9, 0),
    published: false,
  },
].map((event) => ({
  ...event,
  // A meeting runs three hours; an all-day event closes at the end of its last
  // day. The rover challenge is the only one that spans more than one.
  endsAt: event.allDay
    ? endOfDayAfter(event.startsAt, event.slug === 'university-rover-challenge' ? 3 : 0)
    : hoursAfter(event.startsAt, 3),
}))

/**
 * Placeholder sponsors — invented names, real tiers. The landing page shows the
 * top five, which `GET /api/sponsors` yields by ordering on tier, so there are
 * six here: the sixth is what proves the cut-off works.
 */
const sponsors = [
  {
    name: 'Northgate Manufacturing',
    tier: 'PROCESSOR_PATRON' as const,
    blurb: 'Machining and fabrication for every competition chassis we have built.',
    websiteUrl: 'https://example.com',
  },
  {
    name: 'Halden Robotics Supply',
    tier: 'CIRCUIT_SUPPORTER' as const,
    blurb: 'Actuators, sensors and the parts budget that keeps the lab stocked.',
    websiteUrl: 'https://example.com',
  },
  {
    name: 'Meridian Aerospace',
    tier: 'CIRCUIT_SUPPORTER' as const,
    blurb: 'Travel support for the rover team and mentors on the design reviews.',
    websiteUrl: 'https://example.com',
  },
  {
    name: 'Cedar Valley Engineering',
    tier: 'BOLT_BACKER' as const,
    blurb: 'Sponsors the electrical bench and the annual soldering workshop.',
    websiteUrl: 'https://example.com',
  },
  {
    name: 'Lakeside Additive',
    tier: 'ALUMINUM_ALLY' as const,
    blurb: 'Filament and resin for the print farm.',
    websiteUrl: 'https://example.com',
  },
  {
    name: 'Local Makerspace',
    tier: 'ALUMINUM_ALLY' as const,
    blurb: 'Shop access and tooling outside lab hours.',
    websiteUrl: 'https://example.com',
  },
]

async function main() {
  // No slug: a login that isn't a roster entry, so nothing public lists it.
  const admin = await prisma.user.upsert({
    where: { email: 'admin@rccf.local' },
    update: {},
    create: {
      email: 'admin@rccf.local',
      fullName: 'Site Admin',
      passwordHash: await hashPassword(
        process.env.SEED_ADMIN_PASSWORD ?? 'changeme',
      ),
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

  for (const { subteam, ...officer } of officers) {
    // `officerPosition` is unique, so a placeholder can only take a seat nobody
    // else holds. Once a real officer has been entered in Studio, re-running the
    // seed has to leave them in place rather than fail on the constraint — the
    // placeholder still lands on the roster, just without the seat.
    const incumbent = await prisma.user.findFirst({
      where: { officerPosition: officer.officerPosition, slug: { not: officer.slug } },
      select: { fullName: true },
    })

    if (incumbent) {
      console.log(
        `Leaving ${officer.officerPosition} with ${incumbent.fullName}; ` +
          `seeding ${officer.fullName} without a seat.`,
      )
    }

    const data = {
      ...officer,
      officerPosition: incumbent ? null : officer.officerPosition,
      subteam: subteam ? { connect: { slug: subteam } } : undefined,
    }
    await prisma.user.upsert({
      where: { slug: officer.slug },
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
    officers: await prisma.user.count({ where: { officerPosition: { not: null } } }),
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
