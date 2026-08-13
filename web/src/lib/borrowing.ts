/**
 * Dates for the borrowing form: the `<input type="date">` convention in one
 * place, so the member's page and the officer's desk cannot disagree about
 * what "back by Friday" means.
 *
 * A date input speaks `YYYY-MM-DD` and nothing else — no time, no zone. Every
 * function here is about the two edges of that: turning a picked day into the
 * instant the API wants, and counting days the way `server/src/loanWindow.ts`
 * counts them, so the form never offers a window the server will refuse.
 *
 * **Nothing here trusts `new Date` with a value from the box.** See
 * `isDateValue` for what that buys.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * How far ahead a booking box will go. Mirrors `MAX_BOOKING_DAYS` in
 * `server/src/routes/equipment.ts`, which is the one that actually refuses.
 */
export const BOOKING_HORIZON_DAYS = 180

/**
 * The furthest out any date box on either page will accept, as a `max`.
 *
 * Ten years, and it exists to be an upper bound rather than a policy — the
 * officer's due date is deliberately uncapped by the item's limit, but "some
 * time this decade" is still true of every loan the club will ever make. The
 * route refuses the same range, in `loanDate`.
 */
export const LAST_SENSIBLE_DATE = (): string => addDays(today(), 10 * 365)

/** A `Date` as the value a date input holds, in the viewer's own timezone. */
export function dateValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

export const today = (): string => dateValue(new Date())

/** An ISO instant as that value, or empty when there is no instant. */
export const dateInputValue = (iso: string | null | undefined): string =>
  iso ? dateValue(new Date(iso)) : ''

/**
 * Whether a date box's value is one this module will do arithmetic on: a
 * **four-digit** year, and a day that exists.
 *
 * This is the guard the rest of the file is built on, and it is here because
 * a date input does not stop at four digits. The HTML grammar says "four or
 * more", so every browser lets somebody type 12345 into the year — and what
 * comes back is a string `new Date` cannot parse at all.
 *
 * That failure is silent in three separate ways, which is what made it worth a
 * function rather than a check at the one call site:
 *
 *   - `new Date('12345-08-14').getTime()` is `NaN`, and **every comparison
 *     against NaN is false**. A cap written as `days > maxLoanDays` therefore
 *     passes, and the longest loan in the club's history goes through.
 *   - Comparing the values as *strings* to see which comes first is wrong the
 *     moment they are different lengths: `'12345-08-14' < '2026-08-07'` is
 *     true, so a date three centuries out reads as being in the past.
 *   - `.toISOString()` on the resulting Invalid Date throws `RangeError`,
 *     inside a submit handler, where nothing is catching it.
 *
 * The round-trip at the end is what rejects 2026-02-31, which `Date` would
 * otherwise roll forward into March without saying so.
 */
const DATE_VALUE = /^\d{4}-\d{2}-\d{2}$/

export function isDateValue(value: string): boolean {
  if (!DATE_VALUE.test(value)) return false

  const at = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(at.getTime()) && at.toISOString().startsWith(value)
}

/**
 * `YYYY-MM-DD`, n days on, or empty if it was not a date to begin with.
 *
 * Empty rather than a throw: every caller is filling a date box in, and a box
 * that empties beside a complaint about the date above it is a state the page
 * can draw. A `RangeError` out of an onChange handler is not.
 */
export function addDays(value: string, days: number): string {
  if (!isDateValue(value)) return ''

  const at = new Date(`${value}T00:00:00Z`)
  return new Date(at.getTime() + days * DAY_MS).toISOString().slice(0, 10)
}

/**
 * Whole days between two picked days, which is how a person counts a loan.
 * Null when either end is not a date — never `NaN`, which compares false
 * against everything and takes the caller's check down with it.
 */
export function daysBetween(from: string, to: string): number | null {
  if (!isDateValue(from) || !isDateValue(to)) return null

  const start = new Date(`${from}T00:00:00Z`).getTime()
  const end = new Date(`${to}T00:00:00Z`).getTime()
  return Math.round((end - start) / DAY_MS)
}

/** What is wrong with a borrowing window, if anything. */
export type WindowFault = 'start' | 'due' | 'backwards' | 'too-long'

/**
 * The one place the form's dates are judged.
 *
 * Ordered so the reader is told about the box they broke before being told
 * about the arithmetic that could not then be done on it — "that is longer
 * than 7 days" is a confusing answer to a year with five digits in it. The
 * start is judged even when there is no return date yet, or a broken start
 * would empty the box below it and take its own complaint down with it.
 *
 * An **empty** return date is not a fault. It is a question nobody has
 * answered, and a form that goes red the moment it opens has told the reader
 * off for arriving.
 */
export function windowFault(
  from: string,
  to: string,
  maxLoanDays: number,
): WindowFault | null {
  if (!isDateValue(from)) return 'start'
  if (to === '') return null
  if (!isDateValue(to)) return 'due'

  // Non-null: both ends were just checked.
  const days = daysBetween(from, to)!

  if (days < 0) return 'backwards'
  if (days > maxLoanDays) return 'too-long'

  return null
}

/**
 * The top of a chosen day, as an instant. Null if it was not a day.
 *
 * Local, deliberately — the member picked a day in the timezone they are
 * standing in, and midnight UTC is the previous evening for half the world.
 */
export const startOfDay = (value: string): string | null =>
  isDateValue(value) ? new Date(`${value}T00:00`).toISOString() : null

/**
 * The end of a chosen day. "Back by Friday" means Friday, not Friday at
 * midnight when it was still Thursday — the same convention the officer's
 * due-date box has always used.
 */
export const endOfDay = (value: string): string | null =>
  isDateValue(value) ? new Date(`${value}T23:59`).toISOString() : null

/** "up to 7 days" / "up to 1 day", for a sentence about an item's cap. */
export const capPhrase = (maxLoanDays: number): string =>
  `${maxLoanDays} ${maxLoanDays === 1 ? 'day' : 'days'}`
