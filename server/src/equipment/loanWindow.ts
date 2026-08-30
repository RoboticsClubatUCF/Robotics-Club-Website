import { z } from 'zod'

/**
 * How long a loan runs, in the units a person borrowing something thinks in.
 *
 * Two routers need this and they must agree: `routes/member/equipment.ts` refuses an
 * ask that runs past the item's cap, and `routes/officer/officer.ts` uses the same
 * arithmetic to fill in a due date the officer did not type. Two copies of
 * "what is a week" is how the form accepts a window the desk then shortens.
 */

export const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

/**
 * Whole days from one instant to another, **floored**.
 *
 * Floored rather than rounded up, and that is the whole reason this is a
 * function. The browser sends the end of the chosen day — a member picking
 * "next Friday" on a Friday afternoon is asking for seven days and nine hours,
 * and `Math.ceil` would call that eight and refuse a week-long loan of a
 * week-capped item. Nobody would ever find out why. Floor reads the way the
 * member counted: the hours left over on the last day are part of that day.
 *
 * The hour taken off the top is for the clocks changing. A booking that runs
 * from midnight to the end of a day n days later is `n` days and 23:59 of
 * wall-clock time — except across a fall-back Sunday, when it is `n` days and
 * 24:59 and floors to `n + 1`. That would refuse, twice a year and only for
 * people borrowing right up to the cap, a window the form had just offered
 * them. An hour of slack costs nothing anybody can perceive and makes the
 * browser's arithmetic and this agree all year.
 */
export const loanDays = (from: Date, to: Date): number =>
  Math.floor((to.getTime() - from.getTime() - HOUR_MS) / DAY_MS)

/** The far end of the longest loan an item allows, from a given start. */
export const capFrom = (from: Date, maxLoanDays: number): Date =>
  new Date(from.getTime() + maxLoanDays * DAY_MS)

/**
 * When a loan actually begins.
 *
 * A `startAt` that has already gone by means now, rather than an error. The
 * date box sends midnight at the top of the chosen day, so "starting today" is
 * a past instant from about a minute after midnight onwards — refusing it would
 * be a validation failure about the clock that the member has no way to read.
 * Null for "as soon as you can" arrives here the same way and comes out the
 * same way, which is the point.
 */
export const startsAt = (startAt: Date | null | undefined, now: Date): Date =>
  startAt && startAt > now ? startAt : now

/** Ten years. Nothing the club lends is spoken for further out than that. */
const HORIZON_YEARS = 10
/** Before the club existed, so nothing real is on the wrong side of it. */
const EARLIEST = Date.UTC(2000, 0, 1)

/**
 * A date on a loan, bounded to one somebody could plausibly have meant.
 *
 * `z.coerce.date()` alone is not enough, and the reason is the box these
 * arrive from. An `<input type="date">` takes a year of **four or more**
 * digits — the HTML grammar says so — so a slipped keystroke produces 12345
 * or 275760, and what reaches the API is either a string `Date` refuses
 * outright or an instant three hundred millennia out. The range checks in
 * `routes/member/equipment.ts` do already turn the second into a 400, but only
 * incidentally: it is refused for being longer than a week rather than for
 * being wrong, and an officer reading that message would go looking for the
 * wrong problem. Anything reusing this schema gets the honest answer for free.
 *
 * The browser is guarded separately, in `web/src/lib/equipment/borrowing.ts` — there the
 * same value makes a cap check silently pass, which is worse than a bad
 * message.
 */
export const loanDate = z.coerce.date().refine(
  (at) => {
    const ms = at.getTime()
    return ms > EARLIEST && ms < Date.now() + HORIZON_YEARS * 365 * DAY_MS
  },
  { message: 'That date does not look right — check the year.' },
)
