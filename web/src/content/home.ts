import type { ApiStats } from '../lib/api/api'

/**
 * Landing page configuration — and, at this point, almost no copy.
 *
 * The rule of thumb has been applied down to the bone: if an officer would want to change it
 * without a deploy, it belongs in the database. The project list went first, then the officer
 * board, then the sponsors, then the hero's photographs — and now the headline, the lede, the FAQ
 * and the partner programs.
 *
 * What's left isn't copy, and each piece says why it stays. The nav's two lists are the page's
 * own table of contents. The stat strip's cells are a label bound to a count the server computes.
 * The social links are the club's own accounts, printed by a footer that renders before any
 * request comes back.
 */

export type NavLink = {
  href: string
  label: string
}

/**
 * The nav's links, in two lists, because they're two different promises.
 *
 * One list scrolls you down the front page and the other leaves it, and a bar that mixes them
 * makes every link a coin toss. `SiteNav` draws a rule between the two and labels them, which is
 * why they're separate exports rather than one array with a flag on it.
 *
 * They're written `/#events` rather than `#events` because the nav is in the layout and shows on
 * every route. A bare `#events` on the join page scrolls to nothing.
 */

/**
 * In the order the sections appear on the landing page, and it has to stay that way. This is a
 * table of contents — a reader who presses the third word and lands above the thing the second
 * word named has been told the page is in an order it isn't.
 *
 * The hero and the stat strip are deliberately absent: the first is what you're already looking
 * at, and the second is a row of links itself.
 *
 * `/#partners` is the one entry that can point at nothing. The partner section takes itself off
 * the page when the club lists no programs — and a nav that fetched the page's copy on every
 * route to find that out would be a request on the login screen to decide whether to grey out a
 * word.
 */
export const sectionLinks: NavLink[] = [
  { href: '/#sponsors', label: 'Sponsors' },
  { href: '/#events', label: 'Events' },
  { href: '/#officers', label: 'Officers' },
  { href: '/#partners', label: 'Partners' },
  { href: '/#faq', label: 'FAQ' },
]

/**
 * Somewhere else on the site. "Sign in" joins these in `SiteNav` while nobody is signed in, and
 * the gold join button is the last of them — not in this list because it's a button and it
 * changes into an avatar, neither of which a list of words can say.
 */
export const pageLinks: NavLink[] = [{ href: '/projects', label: 'Projects' }]

export type Stat = {
  /** Set uppercase here, not with `text-transform` — these are written as
      labels, and the roman-numeral-ish look of the mono face depends on it. */
  label: string
  /** Each cell links to the page it counts, and all four now exist. A count here and the default
      filter on the page it points at have to stay in step; `GET /stats` is where that's kept. The
      members cell is the one exception, and its label carries the difference. */
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
  // The label is doing real work here, and `/members` repeats it on the chip it opens with. The
  // count is the active membership and so is that default list; the whole table is a chip further
  // on. Labelling the cell MEMBERS would promise the table and deliver the club.
  { countOf: 'members', label: 'ACTIVE MEMBERS', href: '/members' },
  // Says what it counts, like the members cell beside it: `GET /stats` counts
  // `when=upcoming` and `/events` opens on the same, so the cell, the number
  // and the page a reader lands on all mean the one thing.
  { countOf: 'events', label: 'UPCOMING EVENTS', href: '/events' },
  // "Est. 1972" split across the strip's number/label rhythm rather than set as
  // one string, so it lines up with the three cells beside it. Keeps the gold.
  { value: '1972', label: 'ESTABLISHED', href: '/about', accent: true },
]

/**
 * The project list used to live here. It is `GET /api/projects` now, and the
 * copy moved into `server/prisma/seed.ts` — see `ApiProject` in `src/lib/api`.
 */

/**
 * The officer board's seats used to be listed here, and aren't any longer.
 *
 * It said there were eight and what they were called, which made the frontend the authority on
 * the shape of the board — a ninth seat in `OfficerPosition` wouldn't have appeared until this
 * file was edited, and an officer holding no seat couldn't be drawn. Both come from the database
 * now. This note is here because the list is exactly the sort of thing that gets added back.
 */

/**
 * The partner programs and the FAQ used to be here, and they're `partner_programs` and `faqs` now.
 *
 * They were the two clearest cases against the rule at the top of this file. The FAQ carried the
 * price of membership, the lab's address and a person's name — three things that change without
 * the site being deployed. The partner cards were placeholder blurbs waiting on words from
 * somebody who isn't a developer.
 */

/**
 * The club's own accounts. These are real and are no longer placeholders — the note that used to
 * sit here outlived the four invented hrefs it was written about, which is the way a stale caveat
 * does damage: it invites the next person to treat a working link as scaffolding.
 *
 * They're here rather than in the database on the rule at the top of this file. A club changes
 * its Instagram handle roughly never, and the footer has to render before any request comes back.
 */
export const socialLinks: NavLink[] = [
  { href: 'https://www.instagram.com/ucf_robotics/?hl=en', label: 'INSTAGRAM' },
  { href: 'https://discord.gg/m8XZahpNjR', label: 'DISCORD' },
  { href: 'https://github.com/RoboticsClubatUCF', label: 'GITHUB' },
  { href: 'https://www.youtube.com/@roboticsclubatucf', label: 'YOUTUBE' },
]

/**
 * The hero's headline and lede used to be here too, and are `front_page` now —
 * one row, written from the same desk. What the club leads with was the last
 * thing on this page that took a pull request to change.
 */
