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
 * The benefits list used to be turned into a textarea and back here. It is
 * `linesToText`/`linesFromText` in `lib/textLines.ts` now — the front page's FAQ
 * steps and the about page's paragraphs are the same box doing the same job, and
 * a second copy of four lines is a second copy that can drift on what counts as
 * a blank line.
 */
