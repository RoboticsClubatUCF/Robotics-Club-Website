import { hits } from './equipment/catalogue'
import type { ApiOfficerTerm, OfficerPosition } from './api/api'

/**
 * The four fields everything below actually reads.
 *
 * Structural rather than `ApiOfficerTerm`, because the officers desk sends a richer row
 * and reuses every function here. Narrowing to what's used means the desk's rows pass
 * through unchanged instead of being copied into a second shape first.
 */
export type TermLike = Pick<
  ApiOfficerTerm,
  'position' | 'startedAt' | 'endedAt' | 'fullName'
>

/**
 * Reading the officer archive: how a term's year is written, and what the search box
 * and the two chip rows on `/officers` do.
 *
 * Here rather than in the page for the reason `catalogue.ts` is: these are decisions
 * with edge cases — a term that ran inside one year, a term that ran across four — and
 * a decision with an edge case wants a test that doesn't have to render anything.
 *
 * Filtered in the browser, deliberately. `GET /api/officers/past` sends the whole
 * archive because eight seats a year against a fifty-year club is a list too long to
 * scan, not one too long to send.
 */

/**
 * Which academic year a date falls in, as a number.
 *
 * August is the cut-over, so a term starting in January 2025 is filed under 2024 — the
 * year that August began — because that's the year somebody served in. A fixed month
 * rather than a read of the real term dates: those are configurable on the terms desk,
 * and a heading that reshuffled the archive because an officer corrected spring's start
 * date would be movement nobody could account for.
 */
const ACADEMIC_YEAR_STARTS = 7 // August, zero-based

/**
 * Read in UTC, not in the reader's zone, and that isn't a detail. A term stamped at
 * midnight UTC on 1 August is the previous July in Orlando, so `getMonth()` would file
 * the 2024-2025 board under 2023 here and under 2024 for somebody reading from Berlin.
 */
export const academicYearOf = (date: Date): number =>
  date.getUTCMonth() >= ACADEMIC_YEAR_STARTS
    ? date.getUTCFullYear()
    : date.getUTCFullYear() - 1

/**
 * A term's year, as the archive prints it: "2024-2025".
 *
 * An academic year is always written as two calendar years, because that's what it is.
 * So a term that ran a single semester still reads "2024-2025": heading it "2024" would
 * file an autumn interim apart from the people they served alongside.
 *
 * A term spanning several reads end to end — an advisor from August 2022 to May 2025 is
 * "2022-2025" — which is why the closing year is `to + 1` rather than `to`.
 *
 * An en dash, not a hyphen: it's a range. An open term reads "2024-present"; the
 * archive draws none of those, but the value is well defined.
 */
export function academicYear(startedAt: string, endedAt: string | null): string {
  const from = academicYearOf(new Date(startedAt))

  if (endedAt === null) return `${from}–present`

  return `${from}–${academicYearOf(new Date(endedAt)) + 1}`
}

/** The same, off a term. This string is the group heading and the filter's value, so the
    two can never disagree about which cards belong together. */
export const yearOf = (term: TermLike): string =>
  academicYear(term.startedAt, term.endedAt)

/**
 * The span itself, for the line under a name on an archive card.
 *
 * Month and year, not the day. The date a term closes is the moment the sync noticed a
 * Discord role had gone, which isn't the day the club decided anything — printing it to
 * the day claims a precision the record doesn't have.
 */
const MONTH_YEAR: Intl.DateTimeFormatOptions = {
  month: 'short',
  year: 'numeric',
  // UTC for the reason `academicYearOf` reads in UTC: the card and the heading above it
  // must agree, and they can't if one moves with the reader's clock.
  timeZone: 'UTC',
}

const monthOf = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, MONTH_YEAR)

export const servedRange = (startedAt: string, endedAt: string | null): string =>
  endedAt === null
    ? `${monthOf(startedAt)} – present`
    : `${monthOf(startedAt)} – ${monthOf(endedAt)}`

/**
 * Every year in the archive, in the order the archive shows them.
 *
 * Taken from the order the rows arrived in rather than sorted here. The server orders
 * newest-first and settles ties the same way every time, so re-sorting in the browser
 * would be a second opinion about it — and the one that drifts, since it can't see how
 * the enum is declared.
 */
export function yearsIn(terms: TermLike[]): string[] {
  const seen: string[] = []

  for (const term of terms) {
    const year = yearOf(term)
    if (!seen.includes(year)) seen.push(year)
  }

  return seen
}

/**
 * Whether a term answers the search box.
 *
 * The name, and only the name. The seat and the year both have a row of chips directly
 * above the box, and a search that quietly matched those too would make the chips look
 * broken — type "president", get every president, press the president chip, watch
 * nothing change.
 *
 * `hits` is the site's one search rule, so this matches every word anywhere.
 */
export const matchesTerm = (term: TermLike, query: string): boolean =>
  hits([term.fullName], query)

/**
 * A seat's printed name, worked out from the value itself.
 *
 * There used to be a hand-written list of the eight in `content/home.ts`, and it was the
 * last thing about the officer board the frontend decided rather than the database: a
 * ninth seat added to `OfficerPosition` wouldn't have appeared until somebody edited
 * that file.
 *
 * Deriving it means the wording follows the enum for free, at the cost of not being able
 * to spell a seat differently from its value. If the club ever wants "Lab Manager" to
 * read "Shop Manager", the fix is an override map here — not a list that also decides
 * how many seats there are.
 *
 * Null is a real answer, not missing data: Discord decides that somebody is an officer
 * and the roles desk decides which chair, so anybody between the two holds no named seat.
 */
export function seatLabel(position: OfficerPosition | null): string {
  if (position === null) return 'Officer'

  return position
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ')
}

/** `ALL` is the chip rows' resting state — no filter rather than a value. */
export const ANY = 'ALL' as const

export type OfficerFilters = {
  query: string
  position: OfficerPosition | typeof ANY
  /** A year *label*, as `academicYear` writes it — not a number. */
  year: string
}

/** The archive, narrowed by all three controls at once. */
export function filterTerms<T extends TermLike>(
  terms: T[],
  { query, position, year }: OfficerFilters,
): T[] {
  return terms.filter(
    (term) =>
      (position === ANY || term.position === position) &&
      (year === ANY || yearOf(term) === year) &&
      matchesTerm(term, query),
  )
}

/**
 * The archive as the page draws it: a heading, then the cards under it.
 *
 * Grouped in the order the terms arrived, so a year's heading appears exactly where its
 * first card would have — the same reasoning as `yearsIn`, and why a filtered archive
 * never leaves an empty heading behind.
 */
export function groupByYear<T extends TermLike>(
  terms: T[],
): { year: string; terms: T[] }[] {
  const groups: { year: string; terms: T[] }[] = []

  for (const term of terms) {
    const year = yearOf(term)
    const group = groups.find((candidate) => candidate.year === year)

    if (group) group.terms.push(term)
    else groups.push({ year, terms: [term] })
  }

  return groups
}
