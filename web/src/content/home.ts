import type { ApiStats, OfficerPosition } from '../lib/api'

/**
 * Landing page copy — the words, not the data.
 *
 * The project list and the three counts in the stat strip come from the API
 * now; what's left here is the writing and the presentation config around it.
 * The rule of thumb: if an officer would want to change it without a deploy, it
 * belongs in the database, not in this file.
 */

export type NavLink = {
  href: string
  label: string
}

/**
 * Four of these are sections of the front page, and they are written `/#events`
 * rather than `#events` because the nav is in the layout now and shows on every
 * route. A bare `#events` on the join page scrolls to nothing; `/#events` goes
 * home and lands on the section from wherever you are, and on the front page
 * itself the browser still treats it as the in-page jump it always was.
 *
 * `Projects` is the odd one out: the on-page project list moved to its own
 * page, so this points at a route nobody has written yet — see
 * `src/pages/ProjectsPage.tsx`.
 */
export const navLinks: NavLink[] = [
  { href: '/projects', label: 'Projects' },
  { href: '/#events', label: 'Events' },
  { href: '/#sponsors', label: 'Sponsors' },
  { href: '/#officers', label: 'Officers' },
  { href: '/#faq', label: 'FAQ' },
]

export type Stat = {
  /** Set uppercase here, not with `text-transform` — these are written as
      labels, and the roman-numeral-ish look of the mono face depends on it. */
  label: string
  /** Each cell links to the page it counts. None of those pages exist yet. */
  href: string
  /** Draws the number in gold. Exactly one stat should set this. */
  accent?: boolean
} & (
  | {
      /** Which count from `GET /api/stats` fills this cell. */
      countOf: keyof ApiStats
      value?: never
    }
  | {
      /** A cell whose number isn't data. The founding year won't change. */
      value: string
      countOf?: never
    }
)

export const stats: Stat[] = [
  { countOf: 'projects', label: 'PROJECTS', href: '/projects' },
  { countOf: 'members', label: 'MEMBERS', href: '/members' },
  // The events page is where opportunities live; the label is the club's word
  // for them, the endpoint is the schema's.
  { countOf: 'events', label: 'OPPORTUNITIES', href: '/events' },
  // "Est. 1972" split across the strip's number/label rhythm rather than set as
  // one string, so it lines up with the three cells beside it. Keeps the gold.
  { value: '1972', label: 'ESTABLISHED', href: '/about', accent: true },
]

/**
 * The project list used to live here. It is `GET /api/projects` now, and the
 * copy moved into `server/prisma/seed.ts` — see `ApiProject` in `src/lib/api`.
 */

/**
 * The eight seats on the officer board, in board order.
 *
 * The site draws one card per seat and fills in whoever `GET /api/officers`
 * says holds it, so this list — not the response — is what decides that there
 * are eight cards and what they are called. An unfilled seat still gets a card.
 * Mirrors the `OfficerPosition` enum in `schema.prisma`; nothing enforces that.
 */
export const officerSeats: { position: OfficerPosition; label: string }[] = [
  { position: 'PRESIDENT', label: 'President' },
  { position: 'VICE_PRESIDENT', label: 'Vice President' },
  { position: 'TREASURER', label: 'Treasurer' },
  { position: 'SECRETARY', label: 'Secretary' },
  { position: 'MARKETING', label: 'Marketing' },
  { position: 'OUTREACH', label: 'Outreach' },
  { position: 'LAB_MANAGER', label: 'Lab Manager' },
  { position: 'FACULTY_ADVISOR', label: 'Faculty Advisor' },
]

export type Faq = {
  question: string
  answer: string
  /** The one answer that is a procedure rather than a paragraph. */
  steps?: string[]
}

/**
 * Club copy, not data — which is why it sits here rather than in Postgres. It
 * is the first thing that should move to the database once officers can edit
 * content, since these answers change with dues, lab hours and staff.
 */
export const faqs: Faq[] = [
  {
    question: 'Do I need experience to join?',
    answer:
      'No, all projects are drop-in certified, so no skills or experience are required for you to join a project! It is, however, required that you become a member before participating in any projects.',
  },
  {
    question: 'How much is membership?',
    answer:
      'Membership is $25 a semester and $50 a year. There will be times in which the lab is open during the summer and during those times membership is completely free!',
  },
  {
    question: 'How do I become a member?',
    answer: 'Becoming a member is as easy as:',
    steps: [
      // Both of these were written before there was anywhere to sign up. The
      // first described a route that did not exist, and the second a members'
      // survey the club has since dropped.
      'Create an RCCF web account with the "Join the club" button up top',
      'Pay your dues',
      'Join a general body meeting (times posted on Discord)',
    ],
  },
  {
    question: 'Can I create my own project?',
    answer:
      'It depends, the approval or denial of a project depends on the number of people interested, the allowed budget, and general approval from administration. If you truly want to start your own project within RCCF start by talking to Crystal or the president.',
  },
  {
    question: 'Can I pay for something to be 3D printed?',
    answer:
      'Yes! Price will vary depending on the size and in-fill of the print. Other than that just make sure you ask early on as we have a lot of projects that require 3D printing and those come first.',
  },
  {
    question: 'Where is the lab located?',
    answer:
      "We are located in UCF's Institute For Simulation & Training at 3100 Technology Pkwy, Orlando, FL 32826.",
  },
  {
    question: 'How do I join a project?',
    answer:
      "Joining a project is easy. Once you've become a member and paid your dues head over to the discord and in bot-cmds type in /teams to pull up all the projects and then all you have to do is pick the ones you want to join. Of course, show up to the meetings as well.",
  },
  {
    question: 'How do sponsorships work?',
    answer:
      "If you would like to sponsor us check out what we offer in our sponsors' page, otherwise it's basically a way to financially support RCCF and its mission.",
  },
]

/** Placeholder hrefs until the club's real handles are confirmed. */
export const socialLinks: NavLink[] = [
  { href: 'https://www.instagram.com/ucf_robotics/?hl=en', label: 'INSTAGRAM' },
  { href: 'https://discord.gg/m8XZahpNjR', label: 'DISCORD' },
  { href: 'https://github.com/RoboticsClubatUCF', label: 'GITHUB' },
]

export const hero = {
  lede: "Ready to dive into hands-on engineering? Whether you are a master at CAD, an experienced coder, or just eager to learn how to build complex systems from the ground up, there's a place for you on our team. Get involved and start building with us today.",
} as const
