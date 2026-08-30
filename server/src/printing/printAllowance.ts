import { prisma } from '../core/db.js'
import { env } from '../core/env.js'
import { PrintRequestStatus } from '../generated/prisma/enums.js'
import type { Season } from '../generated/prisma/enums.js'
import { currentTerm, getTerm } from '../membership/semester.js'
import type { Term } from '../membership/semester.js'

/**
 * How much material a member has left for their own prints this term.
 *
 * **Nothing here is stored.** The balance is the club's number
 * (`PERSONAL_PRINT_GRAMS`) minus the grams an officer recorded on that
 * member's finished personal prints for the term — counted at the moment it is
 * asked for, exactly the way `EquipmentLoan` availability is `quantity` minus
 * the loans currently holding a unit. A balance column would be a number that
 * goes wrong quietly, and the per-semester reset would stop being free: it
 * would become a sweep somebody has to remember to run in August, on a date
 * UCF is free to move.
 *
 * Three parts of the rule, and each is a `where` clause:
 *
 * - **Personal only.** `projectId: null`. A print for a project is uncapped by
 *   the club's decision — honour system, officer's discretion — so it is not
 *   merely exempt from the subtraction, it is not in the query at all.
 * - **Finished only.** `status: DONE`. The grams are spent when the thing is
 *   printed, not when it is asked for. A member with four requests waiting has
 *   spent nothing yet, and a rejected one never spends anything.
 * - **This term only.** The request's frozen `termYear`/`termSeason`, which is
 *   what makes "resets each semester" a comparison of two enum values rather
 *   than date arithmetic against a calendar that gets revised.
 *
 * The term is `currentTerm`, **not** `billableTerm`, and that is the one place
 * on the site where summer is a term in its own right. Dues skip summer
 * because the club does not charge for it; the allowance does not, because the
 * club's answer was that every semester resets it and summer is a semester.
 */
export interface PrintAllowance {
  /** The club's figure for one term, from configuration. */
  limitGrams: number
  /** Grams already spent on finished personal prints this term. */
  usedGrams: number
  /**
   * What is left. **Allowed to be negative**, and deliberately not clamped: an
   * officer can knowingly print past somebody's allowance, and a balance that
   * bottomed out at zero would hide exactly the case the override exists for.
   */
  remainingGrams: number
  /** The term this balance belongs to, so a page can name when it resets. */
  term: Term
}

const build = (usedGrams: number, term: Term): PrintAllowance => ({
  limitGrams: env.PERSONAL_PRINT_GRAMS,
  usedGrams,
  remainingGrams: env.PERSONAL_PRINT_GRAMS - usedGrams,
  term,
})

/** The `where` all of this turns on, in one place so the two readers agree. */
const spentIn = (term: TermKey) => ({
  projectId: null,
  status: PrintRequestStatus.DONE,
  termYear: term.termYear,
  termSeason: term.termSeason,
})

/**
 * A term as a `PrintRequest` stores it.
 *
 * Which term a balance is *about* is not always the one it is now. A request
 * carries the term it was made in, frozen, and that is the bucket its grams
 * land in whenever an officer gets round to settling it — so a print asked for
 * in December and finished in January is charged to the fall, and the check
 * that it fits has to look at the fall too. Reading the current term there
 * instead would compare against a balance the grams are not going to touch.
 */
export interface TermKey {
  termYear: number
  termSeason: Season
}

/** One member's balance in one named term. */
export async function allowanceIn(
  userId: string,
  term: TermKey,
): Promise<PrintAllowance> {
  const [spent, dates] = await Promise.all([
    prisma.printRequest.aggregate({
      where: { userId, ...spentIn(term) },
      _sum: { gramsUsed: true },
    }),
    getTerm(term.termYear, term.termSeason),
  ])

  return build(spent._sum.gramsUsed ?? 0, dates)
}

/** One member's balance for the term we are in now — the member's own view. */
export async function allowanceFor(
  userId: string,
  now: Date = new Date(),
): Promise<PrintAllowance> {
  const term = await currentTerm(now)

  return allowanceIn(userId, { termYear: term.year, termSeason: term.season })
}

/** How a `(person, term)` pair keys the map below. */
export const allowanceKey = (userId: string, term: TermKey): string =>
  `${userId}:${term.termYear}:${term.termSeason}`

/**
 * The same answer for a whole queue, in one query.
 *
 * The officer queue draws up to a hundred rows and wants a balance beside each
 * personal one. Asking per row is the N+1 that turns a fast page slow without
 * anybody noticing, so this is a single `groupBy` — the same shape the
 * equipment availability count uses in `routes/officer/officer.ts`.
 *
 * Grouped by term as well as by person, because a queue can hold requests from
 * either side of a semester boundary and those are different budgets. Every
 * pair asked about is in the map, including people who have spent nothing: a
 * caller reading it back should get a balance rather than an `undefined` it has
 * to know means zero.
 */
export async function allowancesFor(
  pairs: ({ userId: string } & TermKey)[],
): Promise<Map<string, PrintAllowance>> {
  const unique = new Map(
    pairs.map((pair) => [allowanceKey(pair.userId, pair), pair]),
  )

  if (unique.size === 0) return new Map()

  const wanted = [...unique.values()]

  const [spent, terms] = await Promise.all([
    prisma.printRequest.groupBy({
      by: ['userId', 'termYear', 'termSeason'],
      where: { OR: wanted.map((pair) => ({ userId: pair.userId, ...spentIn(pair) })) },
      _sum: { gramsUsed: true },
    }),
    // Distinct terms only — a live queue has one or two, and `getTerm` is
    // served from the day-long calendar cache besides.
    Promise.all(
      [...new Map(wanted.map((p) => [`${p.termYear}:${p.termSeason}`, p])).values()].map(
        async (pair) =>
          [
            `${pair.termYear}:${pair.termSeason}`,
            await getTerm(pair.termYear, pair.termSeason),
          ] as const,
      ),
    ),
  ])

  const dates = new Map(terms)
  const used = new Map(
    spent.map((row) => [
      allowanceKey(row.userId, row),
      row._sum.gramsUsed ?? 0,
    ]),
  )

  return new Map(
    wanted.map((pair) => {
      const key = allowanceKey(pair.userId, pair)
      // Non-null: every distinct term in `wanted` was just looked up above.
      const term = dates.get(`${pair.termYear}:${pair.termSeason}`)!

      return [key, build(used.get(key) ?? 0, term)]
    }),
  )
}
