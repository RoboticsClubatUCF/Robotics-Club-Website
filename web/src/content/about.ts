/**
 * The about page's words — copy, not data.
 *
 * Same rule of thumb as `home.ts` beside it: if an officer would want to change
 * it without a deploy it belongs in the database. Nothing here is close to that
 * yet, because nothing in the schema holds club prose.
 *
 * **The story and the milestones are placeholders and are marked as such on the
 * page.** Two things in this file are *not*: the founding year, which the stat
 * strip has always printed, and the lab's address, which is the club's real one.
 * Everything else is shaped to be replaced by somebody who was actually there —
 * the same arrangement `partnerPrograms` uses, and for the same reason: it is
 * the layout being settled here, not the history.
 */

/** Printed as the stat strip prints it, and it is the one date on this page
    that is not a placeholder. */
export const founded = 1972

/**
 * The lede under the heading. Written to be true of the club as it is today
 * rather than as a claim about its past, which is the half nobody has written
 * down yet.
 */
export const lede =
  'The Robotics Club of Central Florida is a student organisation at UCF. Members design, build and compete with robots — and, more of the time than anybody admits, take apart the ones that stopped working. No experience is needed to join a project, and none of the people running it started with any.'

/**
 * The long form. Three paragraphs is the size the layout is built around; a
 * fourth will fit and a tenth will not.
 */
export const story: string[] = [
  'Placeholder. What the club was founded to do in 1972, who founded it, and what has survived from then to now. Somebody who was there should write this paragraph.',
  'Placeholder. What the club looks like on an ordinary Tuesday: how many people are in the lab, what they are working on, and how a project gets from an idea to a machine that moves.',
  'Placeholder. What the club is for beyond the robots — the members who learned to weld here, the ones who got hired off a competition, and the schools the outreach team visits.',
]

export type Milestone = {
  /** A year, or a span. Printed in the gold mono column. */
  when: string
  what: string
}

/**
 * The timeline. Deliberately short: a page of thirty entries is an archive, and
 * this is an introduction.
 *
 * **Only the first row is real.** The rest are placeholders holding the shape —
 * a year, and one sentence that says what changed.
 */
export const milestones: Milestone[] = [
  { when: '1972', what: 'The club is founded at what was then Florida Technological University.' },
  { when: 'PLACEHOLDER', what: 'Placeholder — the first competition the club entered, and how it went.' },
  { when: 'PLACEHOLDER', what: 'Placeholder — when the club moved into the lab it works out of today.' },
  { when: 'PLACEHOLDER', what: 'Placeholder — a result, a build or a year worth naming.' },
  { when: 'PLACEHOLDER', what: 'Placeholder — the most recent thing worth putting on this list.' },
]

/**
 * Where the lab is.
 *
 * **The same address is written out in prose in the FAQ** — "Where is the lab
 * located" in `home.ts`. Two copies, because one is an answer and one is a
 * postal address, and neither reads right as the other. If the club moves, both
 * change.
 */
export const lab = {
  building: 'UCF Institute for Simulation & Training',
  street: '3100 Technology Pkwy',
  city: 'Orlando, FL 32826',
  /**
   * A map link rather than an embedded map: an iframe from Google would be a
   * third-party frame on a page that has none, and the address is what somebody
   * actually pastes into their own phone.
   */
  mapUrl:
    'https://www.google.com/maps/search/?api=1&query=UCF+Institute+for+Simulation+and+Training%2C+3100+Technology+Pkwy%2C+Orlando%2C+FL+32826',
} as const
