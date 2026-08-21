import { z } from 'zod'
import { Season } from './generated/prisma/enums.js'
import { currentTerm } from './semester.js'

/**
 * Which term a project belongs to, on the wire.
 *
 * Two columns on `Project` say something about when, and they are not the same
 * kind of statement. `season` is free text a lead types — "Spring 2026",
 * "Season-long", "Year-round" all appear in the club's own rows — and it prints
 * under a title and compares to nothing. `(termYear, termSeason)` is the pair
 * `DuesPayment` and `TrialNotice` already carry, and it is the one thing that
 * can answer "is this one of ours *now*". **`season` prints; this decides.**
 *
 * Shared by the create route and the edit route rather than written twice: the
 * pairing rule below is the sort of validation that gets copied once correctly
 * and once not, and the second copy is a project nobody can find.
 */
export const termFields = {
  /**
   * Optional on the wire, required in the column. Leaving both out means "the
   * term we are in", which is what somebody creating a project today means
   * every time; naming one is for the fall build entered in spring.
   */
  termYear: z.number().int().min(2000).max(2100).optional(),
  termSeason: z.enum(Season).optional(),
}

export interface NamedTerm {
  termYear?: number | undefined
  termSeason?: Season | undefined
}

/**
 * Both or neither, and this is not pedantry.
 *
 * A body carrying a season with no year lands the project in whichever year the
 * default happened to pick — a project that quietly vanishes from every
 * dashboard rather than an error somebody sees and fixes.
 */
export const termsAgree = (value: NamedTerm) =>
  (value.termYear === undefined) === (value.termSeason === undefined)

export const TERM_PAIRED = {
  message: 'Name both the term year and the season, or neither.',
  path: ['termSeason'],
}

/**
 * The term to stamp on something being written now.
 *
 * `currentTerm` names the term *ahead* during a break, and that is the right
 * default here for the same reason it is right on the dues page: a project
 * entered over winter break is a spring project, and nobody creating one on
 * 3 January means "last term".
 */
export async function termFor(
  named: NamedTerm,
): Promise<{ termYear: number; termSeason: Season }> {
  if (named.termYear !== undefined && named.termSeason !== undefined) {
    return { termYear: named.termYear, termSeason: named.termSeason }
  }

  const term = await currentTerm()
  return { termYear: term.year, termSeason: term.season }
}

/**
 * Whether a project's stamp is the term we are in.
 *
 * Exact equality, so a project stamped for a term that has not started yet
 * reads as not-current — "current" means the term `currentTerm()` names, and a
 * fall build entered in spring belongs on the fall dashboard, not on this one.
 */
export const isCurrentTerm = (
  project: { termYear: number; termSeason: Season },
  term: { year: number; season: Season },
) => project.termYear === term.year && project.termSeason === term.season
