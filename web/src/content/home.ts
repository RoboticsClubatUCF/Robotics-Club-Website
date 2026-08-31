import type { ApiStats } from '../lib/api/api'

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
 * The nav's links, in two lists, because they are two different promises.
 *
 * One list scrolls you down the front page and the other leaves it, and a bar
 * that mixes them makes every link a coin toss — you cannot tell from the word
 * "Projects" whether pressing it will move the page under you or replace it.
 * `SiteNav` draws a rule between the two and labels them, which is the whole
 * reason they are separate exports rather than one array with a flag on it.
 *
 * They are written `/#events` rather than `#events` because the nav is in the
 * layout and shows on every route. A bare `#events` on the join page scrolls to
 * nothing; `/#events` goes home and lands on the section from wherever you are,
 * and on the front page itself the browser still treats it as the in-page jump
 * it always was.
 */

/**
 * In the order the sections appear on the landing page, and it has to stay that
 * way. This is a table of contents — a reader who presses the third word and
 * lands above the thing the second word named has been told the page is in an
 * order it is not. `pages/public/HomePage.tsx` is the order to match.
 *
 * The hero and the stat strip are deliberately absent: the first is what you
 * are already looking at, and the second is a row of links itself.
 */
export const sectionLinks: NavLink[] = [
  { href: '/#sponsors', label: 'Sponsors' },
  { href: '/#events', label: 'Events' },
  { href: '/#officers', label: 'Officers' },
  { href: '/#partners', label: 'Partners' },
  { href: '/#faq', label: 'FAQ' },
]

/**
 * Somewhere else on the site. "Sign in" joins these in `SiteNav` while nobody
 * is signed in, and the gold join button is the last of them — it is not in
 * this list because it is a button and it changes into an avatar, neither of
 * which a list of words can say.
 */
export const pageLinks: NavLink[] = [{ href: '/projects', label: 'Projects' }]

export type Stat = {
  /** Set uppercase here, not with `text-transform` — these are written as
      labels, and the roman-numeral-ish look of the mono face depends on it. */
  label: string
  /** Each cell links to the page it counts, and all four now exist — the strip
      draws them as `<Link>`s. A count here and the default filter on the page
      it points at have to stay in step; `GET /stats` is where that is kept.
      The members cell is the one exception, and its label carries the
      difference — see the list below. */
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
  // **The label is doing real work here.** `/members` lists every account the
  // club has, guests included; this counts the active membership, which is a
  // fraction of it. Labelling the cell MEMBERS while sending a reader to a page
  // three times longer would read as a broken number, so the cell says what it
  // actually counts. `GET /stats` in `routes/public/content.ts` carries the
  // matching note.
  { countOf: 'members', label: 'ACTIVE MEMBERS', href: '/members' },
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
 * The officer board's seats used to be listed here, and are not any longer.
 *
 * It said there were eight and what they were called, which made the frontend
 * the authority on the shape of the board — a ninth seat in `OfficerPosition`
 * would not have appeared until this file was edited, and an officer holding no
 * seat at all could not be drawn. Both now come from the database:
 * `GET /api/officers` sends the seats *and* the sitting officers, and
 * `seatLabel` in `src/lib/officerTerms.ts` works the wording out from the enum
 * value. This note is here because the list is exactly the sort of thing that
 * gets added back.
 */

export type PartnerProgram = {
  /** A stable key for the list. Never drawn. */
  id: string
  name: string
  /** The mono line above the name: who the program is actually open to. */
  audience: string
  blurb: string
  /** Where somebody goes to take part — the program's own site, not ours. */
  href: string
  /**
   * The link's words, and they name the program on purpose. A section of
   * identical "Learn more" links is a section a screen reader cannot tell
   * apart.
   */
  linkLabel: string
  /**
   * A logo or a photo. Null draws the hatch well, the same "nothing here yet"
   * language the sponsor logos and the empty officer seats use.
   *
   * Typed as a URL rather than an imported asset so a value pasted out of the
   * database — an upload's `/api/files/…` address — works here without the
   * component changing. `imageSrc` is what makes both resolve; see
   * `src/lib/media/storedFiles.ts`.
   */
  imageUrl: string | null
}

/**
 * The programs somebody can take part in when they cannot join the club.
 *
 * Membership needs a working `@ucf.edu` address and there is no way past that
 * step, which leaves everybody else — school teams, mentors, volunteers,
 * students at other schools — with nowhere on this site to go. These are the
 * programs the club is involved with that will have them.
 *
 * **The blurbs and the artwork are placeholders**, and only those: the names
 * and the two official sites are real. It is the shape that is being fixed
 * here, so the club can drop the real words and images in without touching the
 * component.
 *
 * Copy for the same reason the FAQ is copy — and the same candidate to move to
 * the database first, on the rule of thumb at the top of this file.
 */
export const partnerPrograms: PartnerProgram[] = [
  {
    id: 'vex',
    name: 'VEX Robotics',
    audience: 'PLACEHOLDER — WHO IT IS FOR',
    blurb:
      'Placeholder. What RCCF does with VEX, who the program takes, and what somebody outside UCF actually turns up to. Two or three sentences is the size this card is built around.',
    href: 'https://www.vexrobotics.com/',
    linkLabel: 'Visit VEX Robotics',
    imageUrl: null,
  },
  {
    id: 'first',
    name: 'FIRST Robotics',
    audience: 'PLACEHOLDER — WHO IT IS FOR',
    blurb:
      "Placeholder. The same again for FIRST — the club's involvement, the teams it reaches, and how to get in touch with the people running it locally.",
    href: 'https://www.firstinspires.org/',
    linkLabel: 'Visit FIRST',
    imageUrl: null,
  },
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
      // These were written before there was anywhere to sign up, and the first
      // described a route that did not exist. The survey step is back — not the
      // one the club dropped years ago, but the one-time member survey the site
      // now asks for before anything opens, dues included. It goes second
      // because that is the order the gate enforces.
      'Create an RCCF web account with the "Join the club" button up top',
      'Fill in the member survey — two minutes, and you are only asked once',
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

/**
 * The club's own accounts. **These are real and are no longer placeholders** —
 * the note that used to sit here outlived the four invented hrefs it was
 * written about, which is the way a stale caveat does damage: it invites the
 * next person to treat a working link as scaffolding and replace it.
 *
 * They are here rather than in the database on the rule at the top of this
 * file. A club changes its Instagram handle roughly never, and the footer that
 * prints these has to render before any request comes back.
 */
export const socialLinks: NavLink[] = [
  { href: 'https://www.instagram.com/ucf_robotics/?hl=en', label: 'INSTAGRAM' },
  { href: 'https://discord.gg/m8XZahpNjR', label: 'DISCORD' },
  { href: 'https://github.com/RoboticsClubatUCF', label: 'GITHUB' },
  { href: 'https://www.youtube.com/@roboticsclubatucf', label: 'YOUTUBE' },
]

export const hero = {
  lede: "Ready to dive into hands-on engineering? Whether you are a master at CAD, an experienced coder, or just eager to learn how to build complex systems from the ground up, there's a place for you on our team. Get involved and start building with us today.",
} as const
