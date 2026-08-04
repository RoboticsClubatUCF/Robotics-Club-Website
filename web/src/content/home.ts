import type { ApiStats } from '../lib/api'

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
 * Only `#projects` and `#join` resolve today. The other three are the planned
 * information architecture, kept here so the nav is designed against the real
 * shape of the site rather than being padded out later; they become routes once
 * there is a router.
 */
export const navLinks: NavLink[] = [
  { href: '#projects', label: 'Projects' },
  { href: '#events', label: 'Events' },
  { href: '#sponsors', label: 'Sponsors' },
  { href: '#members', label: 'Members' },
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

export type MeetingSpec = {
  term: string
  detail: string
  /** Draws the value in gold — used to make the dues line impossible to miss. */
  accent?: boolean
}

export const meetingSpecs: MeetingSpec[] = [
  { term: 'WHEN', detail: 'Wed · 6:30 PM' },
  { term: 'WHERE', detail: 'ENG II 105 · Main Campus' },
  { term: 'DUES', detail: '$20 / semester', accent: true },
]

/** Placeholder hrefs until the club's real handles are confirmed. */
export const socialLinks: NavLink[] = [
  { href: '#', label: 'INSTAGRAM' },
  { href: '#', label: 'DISCORD' },
  { href: '#', label: 'GITHUB' },
]

export const hero = {
  lede: "Ready to dive into hands-on engineering? Whether you are a master at CAD, an experienced coder, or just eager to learn how to build complex systems from the ground up, there's a place for you on our team. Get involved and start building with us today.",
} as const

export const meeting = {
  blurb:
    'General body meeting every other Wednesday, then straight into project builds. Bring a laptop, or bring nothing.',
} as const
