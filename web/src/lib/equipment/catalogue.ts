/**
 * Showing a long lending list a few rows at a time.
 *
 * Both ends of the equipment feature draw the same list against the same problem — the club's shelf
 * grows and nobody's does the opposite — so the two decisions in it live here rather than twice:
 * what a search matches, and how many rows a page opens with. A member scrolling past forty cards
 * to find the drill and an officer scrolling past forty rows to check whether the drill is already
 * listed are the same complaint.
 *
 * Filtered in the browser, deliberately. The whole catalogue is already fetched and a club's tool
 * shelf is a few hundred rows at most; the box is for a list too long to *scan*, not one too long
 * to send. The day those become the same problem this wants `?q=` on the route and a debounce.
 */

/**
 * How many rows a list opens with.
 *
 * Five is short enough to take in without scrolling and long enough that a search usually lands
 * inside it — and being visibly cut is the point: a list that quietly stops at five looks like the
 * whole inventory, which is the misreading that has an officer adding a second drill.
 */
export const LIST_LIMIT = 5

/** Anything with a name and something to say about itself. */
export interface Listed {
  name: string
  description: string | null
}

/**
 * Whether a row answers a search, given everything worth searching it by.
 *
 * The one search rule on the site, and both decisions in it are about how people actually type into
 * a box.
 *
 * Every word has to appear, anywhere, in any field. Not one substring across a joined string, which
 * would make "chen rowan" find nothing while "rowan chen" works — a difference nobody can see and
 * everybody trips over. It also means a queue can be narrowed by typing two facts about a row
 * ("rowan bracket") rather than having to remember one of them exactly.
 *
 * Nulls are dropped rather than stringified: a missing Discord handle must not put the word "null"
 * in the haystack, where searching for it would return every member who has not linked one.
 *
 * An empty search matches everything, so callers can pass the box's value straight in.
 */
export function hits(
  fields: (string | null | undefined)[],
  query: string,
): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true

  const hay = fields.filter(Boolean).join(' ').toLowerCase()
  return terms.every((term) => hay.includes(term))
}

/**
 * Whether a listed item answers a search.
 *
 * Descriptions count as well as names, because "the thing with the charger in
 * it" is how people ask for a tool whose name they never learned.
 */
export const matches = (item: Listed, query: string): boolean =>
  hits([item.name, item.description], query)

export interface Narrowed<T> {
  /** The rows to draw. */
  shown: T[]
  /** How many answered the search, before the cut. */
  matched: number
  /** How many are hidden by the cut, and so how many SHOW ALL would add. */
  hidden: number
}

/**
 * A list, searched and then cut.
 *
 * In that order, so the cut applies to what somebody is looking at rather than to the whole shelf —
 * searching "drill" and being shown five of the eleven matches is useful; being shown whichever of
 * the eleven fell in the first five rows of the inventory is not.
 */
export function narrow<T extends Listed>(
  items: T[],
  query: string,
  showAll: boolean,
): Narrowed<T> {
  const found = query.trim() ? items.filter((item) => matches(item, query)) : items

  return {
    shown: showAll ? found : found.slice(0, LIST_LIMIT),
    matched: found.length,
    hidden: Math.max(0, found.length - LIST_LIMIT),
  }
}

/** The toggle's wording, so both pages say it the same way. */
export const showAllLabel = (hidden: number, showAll: boolean): string =>
  showAll ? 'SHOW FEWER' : `SHOW ALL — ${hidden} MORE`
