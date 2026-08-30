import type { SponsorTier } from './api/api'

/**
 * The rules the sponsor pages and the sponsor desk agree on.
 *
 * This was `content/sponsorship.ts`, and it held four hardcoded tier offers with
 * every amount and benefit spelled PLACEHOLDER — the page even carried a panel
 * admitting it. That copy is `sponsor_tier_offers` now, written by officers at
 * `/dashboard/officer/sponsors`, so what is left here is not content at all: a
 * label, and two numbers the server enforces. Hence `lib/` rather than
 * `content/` — the rule in `.claude/docs/frontend.md` is that a file earns
 * `content/` by holding words somebody wrote, and there are none left in this one.
 */

/**
 * The wire format is the enum name; nobody wants to read the underscore.
 *
 * Here rather than in a component because three of them print it now — the
 * marquee on the front page, the listing on `/sponsors`, and the desk that
 * writes both. How the club's own tier names are spelled is one decision, not
 * three. Same shape as `seatLabel` in `officerTerms.ts`.
 */
export const tierLabel = (tier: SponsorTier): string => tier.replace(/_/g, ' ')

/**
 * Mirrors of what the server refuses, so the desk cannot offer what the route
 * would reject. `MAX_IN_KIND` and `MAX_BENEFITS` in
 * `server/src/routes/officer/sponsorsAdmin.ts` are the real limits — change one and
 * change the other. Same contract as `heroSlides.ts` beside this file.
 */
export const MAX_IN_KIND = 6
export const MAX_BENEFITS = 8

/**
 * The benefits list, as one box of text and back.
 *
 * A benefit is a short line and a tier has a handful of them, so the desk edits
 * the lot as a textarea rather than as a stack of inputs with their own add and
 * remove buttons — which is four times the chrome for something an officer
 * writes in one sitting and rarely touches again. Blank lines are dropped rather
 * than refused: pressing enter twice while typing a list is not a mistake worth
 * a error message.
 */
export const benefitsToText = (benefits: string[]): string => benefits.join('\n')

export const benefitsFromText = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
