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
 * The public roster: users with a slug.
 *
 * Nearly all `MEMBER`, and that is the model rather than laziness. What these
 * people *do* is not in this column: Priya and Sam lead teams, Mateo leads a
 * project, and every one of those facts lives on a `ProjectMember` row against
 * one project — see the sandbox below. `title` is what the roster prints.
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
    role: 'MEMBER' as const,
    title: 'Software Lead',
    gradYear: 2027,
    active: true,
    subteam: 'software',
  },
  {
    slug: 'sam-okafor',
    fullName: 'Sam Okafor',
    role: 'MEMBER' as const,
    title: 'Mechanical Lead',
    gradYear: 2026,
    active: true,
    subteam: 'mechanical',
  },
  {
    slug: 'mateo-ruiz',
    fullName: 'Mateo Ruiz',
    role: 'MEMBER' as const,
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
    role: 'MEMBER' as const,
    title: 'Faculty Mentor',
    gradYear: null,
    active: true,
    subteam: null,
  },
  {
    slug: 'rae-lindqvist',
    fullName: 'Rae Lindqvist',
    role: 'MEMBER' as const,
    title: 'Captain, 2023-2024',
    gradYear: 2025,
    // `active: false` is the *only* thing marking an alumnus now. There was an
    // `ALUMNUS` role saying it a second time, which is exactly the duplication
    // this model got rid of — and `?status=alumni` filtered on this flag even
    // then, so nothing about the roster changed when the role went.
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
 * falling out of the president's card. The advisor is a plain `MEMBER` rather
 * than an `OFFICER` — they sit on the board but hold no student office and have
 * no business in the print queue or the member search, which is the whole
 * reason the seat is a separate field from the role.
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
    role: 'MEMBER' as const,
    bio: 'Placeholder advisor. Replace before this is public.',
    gradYear: null,
    subteam: null,
  },
]

/**
 * A project that exists only so the dashboard has something to show.
 *
 * Separate from the real projects below, and that separation is the point.
 * The seeded *people* are invented, and the real projects deliberately carry
 * no leads for exactly that reason — attaching Priya Raman to Project
 * S.T.O.R.M. would publish a claim about who runs a real thing. This one is
 * labelled in its own summary as scaffolding, so the teams, ranks, meeting
 * schedule and tasks below have somewhere honest to live.
 *
 * Delete it and its members in Studio once the club's own structure is in.
 */
const sandbox = {
  slug: 'seed-sandbox',
  title: 'Seed Sandbox',
  summary:
    'Development scaffolding, not a real project. Seeded so the dashboard has teams, tasks and a meeting to render. Safe to delete.',
  status: 'CONCEPT' as const,
  featured: false,
  // A weekly meeting, so the dashboard calendar has recurring chips to draw
  // without anybody having to set one up by hand first.
  meetingWeekday: 4,
  meetingTime: '18:30',
  meetingLocation: 'ENG2 Lab',
  teams: [
    { name: 'Autonomy', description: 'Navigation, vision, and the arm.' },
    { name: 'Chassis', description: 'Drivetrain, suspension, and the frame.' },
  ],
  /**
   * The permission model, one row each, and the only place any of these four
   * is anything other than a club member. Mateo runs this project and nothing
   * else; Priya leads a team inside it while being nothing in particular
   * anywhere else; Sam, who leads nothing here, is on the roster as "Mechanical
   * Lead" because that is a `title` and titles grant nothing.
   *
   * One `PROJECT_LEAD`, which is the cap — the appointment route refuses a
   * second. `title` here is the display string beside the rank, distinct from
   * the `title` on the user.
   */
  members: [
    { slug: 'mateo-ruiz', rank: 'PROJECT_LEAD' as const, title: 'Project Lead', team: null },
    { slug: 'priya-raman', rank: 'TEAM_LEAD' as const, title: 'Software Lead', team: 'Autonomy' },
    { slug: 'jordan-lee', rank: 'MEMBER' as const, title: null, team: 'Autonomy' },
    { slug: 'sam-okafor', rank: 'MEMBER' as const, title: null, team: 'Chassis' },
  ],
  /**
   * Fixed literal ids because a task has no natural key: upserting on the id
   * is what makes a second `npm run seed` move these rather than mint two more.
   */
  tasks: [
    {
      id: '01936000-0000-7000-8000-000000000a01',
      team: 'Autonomy',
      title: 'Calibrate the depth camera',
      details: 'The mounts moved when the arm was refitted. Redo the intrinsics.',
      assignees: ['jordan-lee'],
    },
    {
      id: '01936000-0000-7000-8000-000000000a02',
      team: 'Chassis',
      title: 'Order replacement drive belts',
      details: null,
      assignees: ['sam-okafor'],
    },
  ],
}

/**
 * The lending list. Upserted on `name`, which is unique — so re-running the
 * seed adjusts these rather than stacking up duplicate drills. No loans are
 * seeded: a borrowing record is a claim that a named person took something,
 * and inventing one is the sort of thing an officer would act on.
 */
const equipment = [
  {
    name: 'Cordless drill',
    description: 'Two batteries and a charger, in the black case.',
    quantity: 2,
  },
  {
    name: 'Soldering station',
    description: 'Hakko, with a fume extractor. Stays in the lab.',
    quantity: 3,
  },
  {
    name: 'Digital calipers',
    description: '150mm, metric and imperial.',
    quantity: 4,
  },
]

/**
 * Stand-in artwork for a project's gallery, so the slideshow has something to
 * be until real build photos go in.
 *
 * Deliberately **external** URLs rather than uploads. `deleteIfStored` only
 * touches `/api/files/` addresses, so seeded rows can be added and removed all
 * day without a single `stored_files` row being created or destroyed — which
 * keeps the storage rules exercised only by genuine uploads, the thing actually
 * worth testing by hand.
 */
const placeholderGallery = (title: string) =>
  ['THE BUILD', 'THE TEAM', 'COMPETITION DAY'].map((label, index) => ({
    url: `https://placehold.co/1600x1000/101010/ffc904/png?text=${encodeURIComponent(`${title}\n${label}`)}`,
    caption: `${label.toLowerCase().replace(/^./, (c) => c.toUpperCase())} — replace me with a real photo.`,
    sortOrder: index,
  }))

/** Stand-in resources, in the shape a real project's would take. */
const placeholderLinks = [
  { label: 'Club Discord', url: 'https://discord.gg/rccf', sortOrder: 0 },
  { label: 'How to join a project', url: 'https://rccf.org/join', sortOrder: 1 },
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

/**
 * Placeholder gallery and links, and **only onto a project that has none**.
 *
 * The rest of the seed can upsert because every row it writes has a natural
 * key. These do not — one gallery slide is much like another — so the obvious
 * `deleteMany` + `createMany` would wipe a lead's real photos every time
 * anybody ran the seed. Checking for emptiness first is what makes re-running
 * safe, and it means a project that has been curated once is never touched
 * again.
 */
async function seedPlaceholderPage(projectId: string, title: string) {
  if ((await prisma.projectImage.count({ where: { projectId } })) === 0) {
    await prisma.projectImage.createMany({
      data: placeholderGallery(title).map((image) => ({ ...image, projectId })),
    })
  }

  if ((await prisma.projectLink.count({ where: { projectId } })) === 0) {
    await prisma.projectLink.createMany({
      data: placeholderLinks.map((link) => ({ ...link, projectId })),
    })
  }
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

  // Passwords for two of the seeded roster members, so every rank the
  // dashboard branches on can actually be signed into. Mateo leads the
  // sandbox project and Jordan is a plain member of it, which between them
  // covers the lead surfaces and the member ones. Same password as the admin;
  // these are `.local` addresses that can receive nothing.
  const devPassword = await hashPassword(
    process.env.SEED_ADMIN_PASSWORD ?? 'changeme',
  )
  for (const [slug, email] of [
    ['mateo-ruiz', 'lead@rccf.local'],
    ['jordan-lee', 'member@rccf.local'],
  ] as const) {
    const existing = await prisma.user.findUnique({ where: { slug } })
    // Only ever adds a way in; never overwrites an address a real member has
    // since been given, and never touches a password already set.
    if (existing && !existing.email && !existing.passwordHash) {
      await prisma.user.update({
        where: { slug },
        data: { email, passwordHash: devPassword },
      })
    }
  }

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
    const row = await prisma.project.upsert({
      where: { slug: project.slug },
      update: project,
      create: project,
    })

    await seedPlaceholderPage(row.id, project.title)

    for (const slug of leads) {
      const user = await prisma.user.findUniqueOrThrow({ where: { slug } })
      const created = await prisma.project.findUniqueOrThrow({
        where: { slug: project.slug },
      })
      await prisma.projectMember.upsert({
        where: {
          projectId_userId: { projectId: created.id, userId: user.id },
        },
        update: { title: 'Lead' },
        create: { projectId: created.id, userId: user.id, title: 'Lead' },
      })
    }
  }

  // The sandbox project, its teams, its ranked members, and its tasks. Upsert
  // throughout, so re-seeding adjusts rather than duplicates.
  {
    const { teams, members, tasks: sandboxTasks, ...project } = sandbox

    const created = await prisma.project.upsert({
      where: { slug: project.slug },
      update: project,
      create: project,
    })

    await seedPlaceholderPage(created.id, project.title)

    const teamIds = new Map<string, string>()
    for (const team of teams) {
      const row = await prisma.team.upsert({
        where: { projectId_name: { projectId: created.id, name: team.name } },
        update: team,
        create: { ...team, projectId: created.id },
      })
      teamIds.set(team.name, row.id)
    }

    for (const { slug, team, ...member } of members) {
      const user = await prisma.user.findUnique({ where: { slug } })
      // The roster members are seeded above, but an officer may have deleted
      // one — a missing fixture is not worth failing the whole seed over.
      if (!user) continue

      const data = { ...member, teamId: team ? (teamIds.get(team) ?? null) : null }
      await prisma.projectMember.upsert({
        where: { projectId_userId: { projectId: created.id, userId: user.id } },
        update: data,
        create: { ...data, projectId: created.id, userId: user.id },
      })
    }

    for (const { id, team, assignees, ...task } of sandboxTasks) {
      const users = await prisma.user.findMany({
        where: { slug: { in: assignees } },
        select: { id: true },
      })

      const data = {
        ...task,
        projectId: created.id,
        teamId: team ? (teamIds.get(team) ?? null) : null,
      }
      await prisma.task.upsert({
        where: { id },
        // Assignees are replaced rather than added to, so re-seeding after
        // somebody was reassigned in Studio puts the fixture back as written.
        update: {
          ...data,
          assignees: {
            deleteMany: {},
            create: users.map((user) => ({ userId: user.id })),
          },
        },
        create: {
          ...data,
          id,
          assignees: { create: users.map((user) => ({ userId: user.id })) },
        },
      })
    }
  }

  for (const item of equipment) {
    await prisma.equipment.upsert({
      where: { name: item.name },
      update: item,
      create: item,
    })
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
    teams: await prisma.team.count(),
    tasks: await prisma.task.count(),
    equipment: await prisma.equipment.count(),
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
