import type { ApiMembership, ApiTerm, MembershipStatus, UserRole } from '../api/api'
import type { ApiState } from '../api/useApi'

/**
 * Turning what the dues API says into what a page prints.
 *
 * All of it is formatting and nothing here decides anything. Prices, dates and
 * status come from the server — a page that worked out its own coverage dates
 * would eventually disagree with the one the member was charged against, and
 * the member would be right.
 */

/**
 * `en-US` explicitly rather than the browser's locale.
 *
 * This is a Florida club and the dates are UCF's, so a member abroad reading
 * "5/9/2027" and wondering whether that is May or September helps nobody. It
 * also keeps the tests from depending on whatever locale the runner has.
 */
const LOCALE = 'en-US'

/**
 * The club's clock, pinned for the same reason `LOCALE` is.
 *
 * These dates are end-of-day boundaries in Orlando — `duesPaidThrough` is
 * 23:59:59 there, which is already the next day in UTC — so the reader's own
 * timezone must not be what decides which day gets printed. Left to the
 * browser, a member reading this from anywhere east of Eastern was told their
 * membership runs a day longer than it does, and the tests agreed with them
 * only because the machine they were written on is in Eastern.
 *
 * Spelled again rather than shared with `lib/events/calendarLinks.ts`, which
 * names the same zone for a different job: that one is a label an `.ics` file
 * format demands, this one is a rule about how to read a stored date.
 */
const CAMPUS_ZONE = 'America/New_York'

/** "$25", and "$25.50" only if there are cents to show. */
export function formatMoney(cents: number): string {
  const dollars = cents / 100

  return dollars.toLocaleString(LOCALE, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  })
}

/** "May 6, 2027" — long month, because a dues deadline is worth reading twice. */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(LOCALE, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: CAMPUS_ZONE,
  })
}

/** "May 6" — for a date in the term being discussed, where the year is noise. */
export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(LOCALE, {
    month: 'long',
    day: 'numeric',
    timeZone: CAMPUS_ZONE,
  })
}

const SEASON_NAMES = {
  SPRING: 'Spring',
  SUMMER: 'Summer',
  FALL: 'Fall',
} as const

/** "Fall 2026". */
export function termLabel(term: ApiTerm): string {
  return `${SEASON_NAMES[term.season]} ${term.year}`
}

/** "Fall 2026 and Spring 2027", or just the one for a semester plan. */
export function termsLabel(terms: ApiTerm[]): string {
  const names = terms.map(termLabel)

  return names.length > 1
    ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
    : (names[0] ?? '')
}

/** Whole days from now until `iso`, rounded up. Never negative. */
export function daysUntil(iso: string, now: number = Date.now()): number {
  const ms = new Date(iso).getTime() - now
  return Math.max(0, Math.ceil(ms / 86_400_000))
}

/** "today", "tomorrow", "in 9 days" — the deadline as somebody would say it. */
export function countdown(iso: string, now: number = Date.now()): string {
  const days = daysUntil(iso, now)

  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}

/**
 * The label on the status chip, and its colour.
 *
 * **`FREE` is not a good state to be in**, and the word has to carry that. It
 * used to mean "the club is charging nobody, you are covered" and it now means
 * "the club is charging nobody, and you have not claimed it" — the same three
 * letters, the opposite answer to *may I get in*. So the chip reads FREE TO
 * CLAIM rather than NO DUES DUE, and it is the same warning colour the club
 * uses for anything that needs a press.
 *
 * `TRIAL` is gone with the status it labelled. One continuous window from the
 * end of one dues-bearing term to three weeks into the next made the split
 * between "the gap" and "the opening weeks" meaningless — same offer, same press.
 *
 * `ACTIVE` used to read PAID, and that was wrong for a whole season a year: a
 * membership can be active without a payment behind it — a claimed window is
 * as covering as anything bought. The word has to be about the membership, not
 * about the money.
 */
/**
 * Whether dues have lapsed and the dashboard is down to its two open pages,
 * mirroring `requireCurrentDues` on the server.
 *
 * The club's line: with dues owed you get **dues & payments** and **your own
 * projects**, and nothing else. Printing, borrowing and every management tool
 * sit behind this — the first two because they are the club spending money on
 * you, the last because running things is for paid-up members.
 *
 * Presentation only. Every route behind a lock re-checks server-side, and this
 * exists so the rail can grey a link out rather than let somebody click through
 * to a 403. Anything but `ready` reads as unlocked, so nothing flashes a padlock
 * at a paid-up member while their standing is still on the wire.
 *
 * `ADMIN` is exempt, here and there. Whoever can fix a membership must not be
 * lockable out by one — and the same exemption covers the survey, so an admin
 * is never sent to it either.
 */
export function duesLocked(
  membership: ApiState<ApiMembership>,
  role: UserRole,
): boolean {
  // The boolean face of `accessLock` below, and deliberately not a second read
  // of `hasAccess`: the rail and the page it links to must lock on the same
  // condition or one of them is lying.
  return accessLock(membership, role) !== null
}

/**
 * Why a page is shut, or `null` when it is not.
 *
 * **One predicate with three sentences**, mirroring `requireCurrentDues` in
 * `server/src/auth/authz.ts`, which decides exactly the same three ways. There used
 * to be two predicates: `duesLocked` for the management pages and a stricter
 * `memberLocked` for printing and borrowing, which also refused a `GUEST`
 * outright. That mattered while the summer and the opening weeks reported
 * `hasAccess: true` for everybody — coverage alone would have let an account
 * made ten minutes ago order prints. Access is the dues date now, and nothing
 * sets that date without promoting the account in the same transaction, so the
 * role check had become one that could never fail for anybody who got past the
 * date. Two locks that always agree are one lock and a place for them to stop
 * agreeing.
 *
 * The three reasons are not decoration. They are the difference between telling
 * somebody the club wants money, telling them it does not want any right now,
 * and telling somebody two years in that they were never a member:
 *
 *   - `survey` — the one-time member survey has not been answered. Ahead of
 *     all three below, because it is the gate ahead of dues on the server too.
 *   - `claim` — a free window is running. Quoting a price would be false; they
 *     are one press from being let in, and it costs nothing.
 *   - `dues` — a date that has run out. A member, on hold, nothing taken away.
 *   - `newcomer` — no date, ever, and nothing free on offer.
 */
export type AccessLock = 'survey' | 'claim' | 'dues' | 'newcomer' | null

/**
 * Why this membership is not cover, ignoring who is looking.
 *
 * Split out from `accessLock` because two callers need the reason without the
 * exemption: the overview's button, which should say CLAIM rather than PAY to
 * an admin who has genuinely not claimed, and the join panel on a public
 * project page, which has a membership and no dashboard context.
 */
export function coverGap(membership: ApiMembership): AccessLock {
  /**
   * **Before `hasAccess`, and that order is the feature.**
   *
   * Somebody an officer granted a term to still owes the survey, and their
   * `hasAccess` is true — so asking about cover first would let them straight
   * past a gate the server is still enforcing, and every click would 403 with
   * a sentence the page never showed them.
   *
   * It also inverts one long-standing rule here: `/dashboard/dues` used to be
   * the one page nothing could lock, because it was where every other lock
   * sent people. The survey is now the page that cannot be locked, and dues is
   * behind it like everything else.
   */
  if (membership.surveyRequired) return 'survey'

  if (membership.hasAccess) return null
  if (membership.canActivate) return 'claim'

  return membership.paidThrough === null ? 'newcomer' : 'dues'
}

export function accessLock(
  membership: ApiState<ApiMembership>,
  role: UserRole,
): AccessLock {
  // Lock nothing until the standing has actually arrived, so no padlock
  // flashes at a paid-up member while their status is still on the wire.
  if (membership.status !== 'ready' || role === 'ADMIN') return null

  return coverGap(membership.data)
}

/**
 * The words each reason gets, in one place.
 *
 * Every one of these lived somewhere else until the free window stopped
 * granting access on its own. Before that, "no cover" only ever happened when
 * money was genuinely owed, so a hardcoded PAY MY DUES was correct wherever it
 * appeared — five pages had one, and all five became wrong on the same day. The
 * button is what has to be right: telling somebody to pay for a thing that is
 * free and one press away is the version of this bug people notice.
 */
export const LOCK_COPY: Record<
  NonNullable<AccessLock>,
  { cta: string; short: string }
> = {
  claim: {
    cta: 'CLAIM MY MEMBERSHIP',
    short: 'FREE RIGHT NOW — NOT SWITCHED ON YET',
  },
  dues: {
    cta: 'PAY MY DUES',
    short: "DUES LAPSED — EVERYTHING COMES BACK WHEN THEY'RE PAID",
  },
  newcomer: {
    cta: 'PAY MY DUES',
    short: 'MEMBERS ONLY — DUES TAKE A MINUTE',
  },
  survey: {
    cta: 'FILL IN THE SURVEY',
    short: 'ONE-TIME MEMBER SURVEY — ABOUT TWO MINUTES',
  },
}

export const STATUS_CHIP: Record<
  MembershipStatus,
  { label: string; className: string }
> = {
  ACTIVE: {
    label: 'ACTIVE',
    className: 'border-success/40 bg-success/10 text-success',
  },
  FREE: {
    label: 'FREE TO CLAIM',
    className: 'border-warning/40 bg-warning/10 text-warning',
  },
  EXPIRED: {
    label: 'DUES UNPAID',
    className: 'border-error/40 bg-error/10 text-error',
  },
}
