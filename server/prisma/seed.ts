import { prisma } from '../src/core/db.js'
import { hashPassword } from '../src/auth/password.js'
import { currentTerm } from '../src/membership/semester.js'

/**
 * Placeholder content so the site has something to render in development.
 * Everything here is upserted on a unique key, so re-running is safe.
 */

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
  },
  {
    slug: 'priya-raman',
    fullName: 'Priya Raman',
    role: 'MEMBER' as const,
    title: 'Software Lead',
    gradYear: 2027,
    active: true,
  },
  {
    slug: 'sam-okafor',
    fullName: 'Sam Okafor',
    role: 'MEMBER' as const,
    title: 'Mechanical Lead',
    gradYear: 2026,
    active: true,
  },
  {
    slug: 'mateo-ruiz',
    fullName: 'Mateo Ruiz',
    role: 'MEMBER' as const,
    title: 'Vision Stack Lead',
    gradYear: 2026,
    active: true,
  },
  {
    slug: 'jordan-lee',
    fullName: 'Jordan Lee',
    role: 'MEMBER' as const,
    title: null,
    gradYear: 2028,
    active: true,
  },
  {
    slug: 'dana-whitfield',
    fullName: 'Dana Whitfield',
    role: 'MEMBER' as const,
    title: 'Faculty Mentor',
    gradYear: null,
    active: true,
  },
  {
    slug: 'rae-lindqvist',
    fullName: 'Rae Lindqvist',
    role: 'MEMBER' as const,
    title: 'Captain, 2023-2024',
    gradYear: 2025,
    // **Both flags, because they are two different facts and this fixture is
    // what proves the roster can tell them apart.** `officerAlumnus` is what
    // `?status=alumni` filters on — mirrored off the club's Discord Officer
    // Alumni role by `syncOfficerAlumni`, which never runs against a seeded
    // database, so a seed that left it false would make the chip permanently
    // empty in development and look broken.
    //
    // `active: false` is the older flag and still means "not around any more".
    // It used to be the only thing marking an alumnus and the chip read it,
    // which could not survive `membershipUpdateFor` setting it back to true on
    // every payment — see `discord/discordAlumni.ts`.
    active: false,
    officerAlumnus: true,
  },
  {
    slug: 'devon-marsh',
    fullName: 'Devon Marsh',
    role: 'MEMBER' as const,
    title: 'Treasurer, 2022-2023',
    gradYear: 2024,
    // The case one boolean could never say: still turning up, still paying, and
    // an officer alumnus. One of the twenty-seven people carrying the role in
    // the club's real guild is in exactly this state.
    active: true,
    officerAlumnus: true,
  },
]

/**
 * The officer board, one placeholder person per seat.
 *
 * Every name here is invented — replace them in Prisma Studio before this goes
 * anywhere public, because the landing page prints these under the club's real
 * office titles and a fake president reads as a real one.
 *
 * `position` is the seat, and it goes on an **open officer term** rather than on
 * the user — that is what "currently on the board" means now. `title` is only
 * the label printed beside them, so an "Interim President" can say so without
 * falling out of the president's card. The advisor is a plain `MEMBER` rather
 * than an `OFFICER` — they sit on the board but hold no student office and have
 * no business in the print queue or the member search, which is the whole
 * reason the seat is a separate field from the role.
 */
const officers = [
  {
    slug: 'placeholder-president',
    fullName: 'Jordan Ellis',
    position: 'PRESIDENT' as const,
    title: 'President',
    role: 'OFFICER' as const,
    bio: 'Placeholder officer. Replace before this is public.',
    gradYear: 2027,
  },
  {
    slug: 'placeholder-vice-president',
    fullName: 'Nia Barrett',
    position: 'VICE_PRESIDENT' as const,
    title: 'Vice President',
    role: 'OFFICER' as const,
    bio: 'Placeholder officer. Replace before this is public.',
    gradYear: 2027,
  },
  {
    slug: 'placeholder-treasurer',
    fullName: 'Owen Castellanos',
    position: 'TREASURER' as const,
    title: 'Treasurer',
    role: 'OFFICER' as const,
    bio: 'Placeholder officer. Replace before this is public.',
    gradYear: 2026,
  },
  {
    slug: 'placeholder-secretary',
    fullName: 'Harper Nakamura',
    position: 'SECRETARY' as const,
    title: 'Secretary',
    role: 'OFFICER' as const,
    bio: 'Placeholder officer. Replace before this is public.',
    gradYear: 2028,
  },
  {
    slug: 'placeholder-marketing',
    fullName: 'Devin Osei',
    position: 'MARKETING' as const,
    title: 'Marketing',
    role: 'OFFICER' as const,
    bio: 'Placeholder officer. Replace before this is public.',
    gradYear: 2027,
  },
  {
    slug: 'placeholder-outreach',
    fullName: 'Simone Alvarez',
    position: 'OUTREACH' as const,
    title: 'Outreach',
    role: 'OFFICER' as const,
    bio: 'Placeholder officer. Replace before this is public.',
    gradYear: 2026,
  },
  {
    slug: 'placeholder-lab-manager',
    fullName: 'Reid Ferguson',
    position: 'LAB_MANAGER' as const,
    title: 'Lab Manager',
    role: 'OFFICER' as const,
    bio: 'Placeholder officer. Replace before this is public.',
    gradYear: 2026,
  },
  {
    slug: 'placeholder-faculty-advisor',
    fullName: 'Dr. Alina Petrov',
    position: 'FACULTY_ADVISOR' as const,
    title: 'Faculty Advisor',
    role: 'MEMBER' as const,
    bio: 'Placeholder advisor. Replace before this is public.',
    gradYear: null,
  },
]

/**
 * The officer archive — invented, like the board above, and for the same
 * reason: `/officers` has three states worth seeing and none of them show
 * up against an empty table.
 *
 * Every name here is made up and printed under the club's real office titles,
 * so **replace these in Prisma Studio before this goes anywhere public**. A
 * fake past president reads as a real one exactly the way a fake sitting one
 * does.
 *
 * What the three shapes in this list are demonstrating, because the page
 * behaves differently for each:
 *
 *   - **`slug` set** — the term links a roster entry, so the card borrows that
 *     person's headshot without the photo being entered twice. This is what
 *     rolling the board over at the end of a year actually looks like: the
 *     sitting officers become terms pointing at their own accounts.
 *   - **`slug` null** — somebody who was president in 2019 and has no account
 *     and never will. Most of a real archive is this, which is why the name
 *     lives on the term rather than behind a required relation.
 *   - **two rows for one seat in one year** — a resignation mid-term. There is
 *     no unique constraint stopping it, on purpose; see `schema.prisma`.
 *
 * Dates rather than academic years, because a term is a span now and the board
 * follows Discord live: `startedAt`/`endedAt` are what the sync writes, and a
 * hand-entered historical row has to be the same shape as one the sync made or
 * the archive is reading two things. August to May is the academic year.
 */
const officerHistory = [
  { position: 'PRESIDENT' as const, startedAt: '2024-08-01', endedAt: '2025-05-31', fullName: 'Priya Raman', slug: 'priya-raman' },
  { position: 'VICE_PRESIDENT' as const, startedAt: '2024-08-01', endedAt: '2025-05-31', fullName: 'Marcus Whitfield', slug: null },
  { position: 'TREASURER' as const, startedAt: '2024-08-01', endedAt: '2025-05-31', fullName: 'Elena Vasquez', slug: null },
  { position: 'SECRETARY' as const, startedAt: '2024-08-01', endedAt: '2025-05-31', fullName: 'Tomas Lindqvist', slug: null },
  { position: 'LAB_MANAGER' as const, startedAt: '2024-08-01', endedAt: '2025-05-31', fullName: 'Aisha Bello', slug: null },
  { position: 'PRESIDENT' as const, startedAt: '2023-08-01', endedAt: '2024-05-31', fullName: 'Grace Okonkwo', slug: null },
  { position: 'VICE_PRESIDENT' as const, startedAt: '2023-08-01', endedAt: '2024-05-31', fullName: 'Daniel Cho', slug: null },
  { position: 'TREASURER' as const, startedAt: '2023-08-01', endedAt: '2024-05-31', fullName: 'Sofia Marchetti', slug: null },
  { position: 'MARKETING' as const, startedAt: '2023-08-01', endedAt: '2024-05-31', fullName: 'Isabel Duarte', slug: null },
  { position: 'OUTREACH' as const, startedAt: '2023-08-01', endedAt: '2024-05-31', fullName: 'Kwame Asante', slug: null },
  // Both halves of one year. Resigned in December; the vice president finished it.
  { position: 'PRESIDENT' as const, startedAt: '2022-08-01', endedAt: '2023-05-31', fullName: 'Ryan Delacroix', slug: null },
  { position: 'PRESIDENT' as const, startedAt: '2022-08-01', endedAt: '2023-05-31', fullName: 'Mei-Lin Zhao', slug: null },
  { position: 'SECRETARY' as const, startedAt: '2022-08-01', endedAt: '2023-05-31', fullName: 'Jonah Feldman', slug: null },
  { position: 'LAB_MANAGER' as const, startedAt: '2022-08-01', endedAt: '2023-05-31', fullName: 'Carmen Ruiz', slug: null },
  // A span rather than a year: the advisor held the seat across all three.
  { position: 'FACULTY_ADVISOR' as const, startedAt: '2022-08-01', endedAt: '2025-05-31', fullName: 'Dr. Harold Kimura', slug: null },
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
  // Two nights a week, so both calendars have recurring chips to draw without
  // anybody setting one up by hand — and so the multi-day case is the one that
  // gets looked at every day rather than the one nobody sees until it breaks.
  meetingWeekdays: [2, 4],
  meetingStartTime: '18:00',
  meetingEndTime: '22:00',
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

/**
 * **Real sponsors are not seeded, and this is the note explaining why not.**
 *
 * The obvious thing to do here is add the companies that actually back the club
 * beside the invented ones. Doing it cost a duplicate the first time it was
 * tried: `upsert` keys on `name`, Postgres compares text case-sensitively, and
 * the club's own row said `GRIPEDGE TOOLS` while the seed said
 * `GripEdge Tools` — so it created a second row for one company, with no logo
 * and no website, on the club's public page. That is the exact collision
 * `nameTaken` in `routes/officer/sponsorsAdmin.ts` refuses, and the seed goes around it.
 *
 * Real sponsors arrive through `/dashboard/officer/sponsors`, where the check
 * runs. The array above stays invented, and the warning on it stays true.
 */

/**
 * **The club's real sponsorship sheet**, and the reason this table is seeded at
 * all when `hero_slides` is not.
 *
 * The rule in [database.md](../../.claude/docs/database.md) is that no invented
 * price goes near this page — a placeholder amount is a figure a business could
 * read off the public site and hold the club to. These are not invented: they
 * are what the club publishes, so seeding them is what puts the real sheet on a
 * fresh database instead of an empty section.
 *
 * **`blurb` is deliberately absent from every one of them.** The club's sheet is
 * an amount over a list of what you get, with no sentence between — writing one
 * to fill the field is exactly the invention this whole feature exists to stop.
 * The column is nullable for that reason.
 *
 * The "Everything in …" lines are the sheet's own `+ Circuit Supporter`
 * shorthand, spelled out: each tier includes the one below it. Written as words
 * rather than as a literal `+`, because the page already prints a `+` in front
 * of every benefit and two of them reads as a typo.
 */
const tierOffers = [
  {
    tier: 'PROCESSOR_PATRON' as const,
    amount: '$5,000+',
    benefits: [
      'Acknowledgments in social media posts',
      'Logo on club promotional materials for community events',
      'Everything in Circuit Supporter',
    ],
  },
  {
    tier: 'CIRCUIT_SUPPORTER' as const,
    amount: 'UP TO $3,000',
    benefits: [
      'Logo on club T-shirts *',
      'Logo on multiple robots/projects of choice',
      'Everything in Bolt Backer',
    ],
  },
  {
    tier: 'BOLT_BACKER' as const,
    amount: 'UP TO $1,000',
    benefits: [
      'Logo on single robot/project of choice **',
      'Everything in Aluminum Ally',
    ],
  },
  {
    tier: 'ALUMINUM_ALLY' as const,
    amount: '$250',
    benefits: [
      'Appearance on club website sponsors page',
      'Logo/Infographic in club workspace *',
      'Member made sponsorship gift',
    ],
  },
]

/**
 * The fine print under the grid. The markers are cited by two different tiers,
 * which is why this is one block under the whole sheet rather than a field on
 * any card in it — see `SponsorshipSheet` in `schema.prisma`.
 *
 * Blank line before the NOTE on purpose: the page prints this with
 * `whitespace-pre-line`, so the lines here are the lines out there.
 */
const sponsorshipFootnotes = `* Logo size determined by donation amount
** Robot(s)/project(s) must be selected at the time of donation

NOTE: Your sponsorship is tax-deductible and we’ll provide a receipt for your records.`

/**
 * Refuse to run against anything that is not a development database.
 *
 * Everything below is invented — eight officers under the club's real office
 * titles, an officer archive that never happened, sponsors that do not exist —
 * and the file has always said "replace before this is public". That sentence
 * was the whole of the protection, and it is addressed to whoever is reading
 * the file rather than to whoever is typing `npm run seed` at three in the
 * morning against the wrong `DATABASE_URL`.
 *
 * It cannot be undone by hand either. The seeded board only takes a chair
 * nobody is sitting in, so on a club database with a real president the
 * placeholder does not get the seat — it lands on the **public roster** as a
 * slugged member instead, and the invented archive stacks onto `/officers`
 * under real seat names. Both look like club history to anyone reading the
 * page.
 *
 * Two conditions, because either alone has a hole. `NODE_ENV=production` is the
 * obvious one and is missing exactly when it matters — a shell on the server
 * with no environment loaded. So the roster is asked as well: a database
 * carrying club members who are not this file's own fixtures is a database this
 * file has no business writing to, whatever `NODE_ENV` claims. `--force` is
 * there for the one legitimate case, a fresh production database somebody
 * genuinely wants demo content in, and it has to be typed.
 */
async function refuseIfNotDevelopment(): Promise<void> {
  if (process.argv.includes('--force')) return

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to seed: NODE_ENV is production. This file writes invented officers and sponsors under the club’s real office titles. Pass --force if that is genuinely what you want.',
    )
  }

  // Anybody on the public roster who is not one of this file's own fixtures.
  // `slug` is the roster, and every slug written below is either in `members`
  // or begins `placeholder-`.
  const known = new Set([
    ...members.map((m) => m.slug),
    ...officers.map((o) => o.slug),
  ])

  const roster = await prisma.user.findMany({
    where: { slug: { not: null } },
    select: { slug: true },
  })

  const strangers = roster.filter(({ slug }) => slug !== null && !known.has(slug))

  if (strangers.length > 0) {
    throw new Error(
      `Refusing to seed: ${String(strangers.length)} ${strangers.length === 1 ? 'person' : 'people'} on the public roster ${strangers.length === 1 ? 'is' : 'are'} not this file's fixtures (e.g. ${strangers[0]?.slug ?? ''}), so this looks like the club's real database. Pass --force to seed anyway.`,
    )
  }
}

async function main() {
  await refuseIfNotDevelopment()

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

  for (const member of members) {
    await prisma.user.upsert({
      where: { slug: member.slug },
      update: member,
      create: member,
    })
  }

  for (const { position, ...officer } of officers) {
    const seeded = await prisma.user.upsert({
      where: { slug: officer.slug },
      update: officer,
      create: officer,
      select: { id: true },
    })

    // The seat is an *open term* now, not a column on the user. Same courtesy
    // as before: a placeholder only takes a chair nobody is sitting in, so once
    // a real officer has been entered the seed leaves them there and lands the
    // placeholder on the roster without a seat.
    const incumbent = await prisma.officerTerm.findFirst({
      where: { position, endedAt: null, userId: { not: seeded.id } },
      select: { fullName: true },
    })

    if (incumbent) {
      console.log(
        `Leaving ${position} with ${incumbent.fullName}; ` +
          `seeding ${officer.fullName} without a seat.`,
      )
      continue
    }

    // Find-then-create rather than upsert: there is no unique key to upsert
    // against, deliberately — see `schema.prisma`.
    const held = await prisma.officerTerm.findFirst({
      where: { userId: seeded.id, endedAt: null },
      select: { id: true },
    })

    if (held) {
      await prisma.officerTerm.update({ where: { id: held.id }, data: { position } })
      continue
    }

    await prisma.officerTerm.create({
      data: {
        position,
        // `MANUAL`, so the Discord sync never closes a seeded seat. These
        // people do not exist in the club's guild, and a sync that stood them
        // down would empty the board on a fresh clone.
        source: 'MANUAL',
        startedAt: new Date(),
        fullName: officer.fullName,
        userId: seeded.id,
      },
    })
  }

  // `officer_terms` has no unique key to upsert against — two people can hold
  // one seat in one year and the schema deliberately allows it — so this is
  // find-then-create rather than `upsert`. Matching on the four columns that
  // *are* the term keeps re-running the seed from stacking up a second archive,
  // and leaves anything an officer has typed in Studio alone: a row edited
  // there no longer matches, so it is neither overwritten nor duplicated.
  for (const { slug, ...term } of officerHistory) {
    const existing = await prisma.officerTerm.findFirst({
      where: {
        position: term.position,
        startedAt: new Date(term.startedAt),
        fullName: term.fullName,
      },
      select: { id: true },
    })

    if (existing) continue

    // Looked up rather than `connect`ed, which throws when the roster entry is
    // gone. The link is a convenience — it lends the card a headshot — and a
    // seed that dies because somebody deleted a placeholder from Studio is
    // worse than one that records the term without it.
    const holder = slug
      ? await prisma.user.findUnique({ where: { slug }, select: { id: true } })
      : null

    await prisma.officerTerm.create({
      data: {
        ...term,
        startedAt: new Date(term.startedAt),
        endedAt: new Date(term.endedAt),
        // Closed, hand-entered history: not the sync's to reopen or re-close.
        source: 'MANUAL',
        userId: holder?.id ?? null,
      },
    })
  }

  // Which term the seeded projects are built for, asked once.
  //
  // Computed rather than written down, so a fresh development database has
  // projects that read as *current* on the dashboard rather than an empty
  // MY PROJECTS and a full past-projects page. `currentTerm` falls back to
  // fixed dates when calendar.ucf.edu cannot be read, so this never fails the
  // seed — approximately the right term is entirely good enough for fixtures.
  const term = await currentTerm()
  const seededTerm = { termYear: term.year, termSeason: term.season }

  // Upsert only: deleting a project from the array above will not remove it
  // from a database that already has it. Delete those by hand, or in Studio.
  //
  // The term goes in `create` and deliberately not in `update`. Rolling a build
  // into the next semester is an officer's edit on a real project, and a seed
  // that re-stamped it on every run would quietly undo that — the one way this
  // script could destroy work rather than top it up.
  for (const { leads, ...project } of projects) {
    const row = await prisma.project.upsert({
      where: { slug: project.slug },
      update: project,
      create: { ...project, ...seededTerm },
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
      create: { ...project, ...seededTerm },
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

  // The tier sheet and its fine print, on the same terms and for the same
  // reason: these are the club's own published numbers, so a fresh database gets
  // the real sheet — but an officer who has since edited an amount at
  // `/dashboard/officer/sponsors` owns it from then on, and re-seeding must not
  // quietly put last year's price back on a page a business is reading.
  for (const offer of tierOffers) {
    await prisma.sponsorTierOffer.upsert({
      where: { tier: offer.tier },
      update: {},
      create: offer,
    })
  }

  await prisma.sponsorshipSheet.upsert({
    where: { id: 'current' },
    update: {},
    create: { id: 'current', footnotes: sponsorshipFootnotes },
  })

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
    officers: await prisma.officerTerm.count({ where: { endedAt: null } }),
    officerTerms: await prisma.officerTerm.count({ where: { endedAt: { not: null } } }),
    projects: await prisma.project.count(),
    events: await prisma.event.count(),
    teams: await prisma.team.count(),
    tasks: await prisma.task.count(),
    equipment: await prisma.equipment.count(),
    sponsors: await prisma.sponsor.count(),
    sponsorTiers: await prisma.sponsorTierOffer.count(),
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
