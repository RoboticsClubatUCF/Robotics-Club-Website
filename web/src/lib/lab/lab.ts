/**
 * The lab's opening hours, as the pages say them out loud.
 *
 * Only the labels live here, never the rule. Whether the building is open is `buildingOpen` in
 * `server/src/lab/labStatus.ts`, decided against a wall clock in `America/New_York` and sent on
 * every `GET /api/lab`. This file is not the mirror that `dues.ts` and `borrowing.ts` are:
 * re-deriving a timezone in the browser would be a second implementation of the one thing about
 * this feature that is genuinely easy to get wrong, for an answer that arrives with every response.
 *
 * What the browser does need is the two numbers in words, because the dashboard's panel explains
 * why its switch is greyed out — and a sentence saying "shut between 10pm and 8am" while the server
 * closes at nine is worse than no sentence. They are written once here and pinned by a test against
 * the server's own `BUILDING_OPENS_AT` / `BUILDING_CLOSES_AT`.
 *
 * The landing page's sign uses neither. It says open or closed and stops there: an officer might
 * open at eight or not at all, and OPENS 8AM was the site making a promise on their behalf. Only
 * the panel — read by the officer who is the promise — prints the hours.
 */

/** `BUILDING_OPENS_AT` — 8 on the server's 24-hour clock. */
export const OPENS_AT = '8am'

/** `BUILDING_CLOSES_AT` — 22. */
export const CLOSES_AT = '10pm'
