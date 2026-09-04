import type { ApiMembership, ApiTerm, MembershipStatus, UserRole } from '../api/api'
import type { ApiState } from '../api/useApi'

/**
 * Turning what the dues API says into what a page prints.
 *
 * All formatting; nothing here decides anything. Prices, dates and status come from
 * the server — a page that worked out its own coverage dates would eventually
 * disagree with the one the member was charged against, and the member would be right.
 */

/**
 * `en-US` explicitly rather than the browser's locale. This is a Florida club and the
 * dates are UCF's, so a member abroad reading "5/9/2027" and wondering whether that's
 * May or September helps nobody. It also keeps the tests off the runner's locale.
 */
const LOCALE = 'en-US'

/**
 * The club's clock, pinned for the same reason `LOCALE` is.
 *
 * These are end-of-day boundaries in Orlando — `duesPaidThrough` is 23:59:59 there,
 * already the next day in UTC — so the reader's own timezone must not decide which day
 * gets printed. Left to the browser, a member east of Eastern was told their
 * membership runs a day longer than it does.
 *
 * Spelled again rather than shared with `lib/events/calendarLinks.ts`, which names the
 * same zone for a different job: that one is a label an `.ics` demands, this is a rule
 * about how to read a stored date.
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
 * `FREE` is not a good state to be in, and the word has to carry that. It used to mean
 * "the club is charging nobody, you are covered" and now means "and you haven't
 * claimed it" — the same three letters, the opposite answer to *may I get in*. So the
 * chip reads FREE TO CLAIM, in the colour the club uses for anything needing a press.
 *
 * `TRIAL` is gone with the status it labelled: one continuous window made the split
 * between "the gap" and "the opening weeks" meaningless.
 *
 * `ACTIVE` used to read PAID, which was wrong for a season a year — a claimed window
 * is as covering as anything bought. The word has to be about the membership, not the
 * money.
 */
/**
 * Whether dues have lapsed and the dashboard is down to its two open pages, mirroring
 * `requireCurrentDues` on the server.
 *
 * The club's line: with dues owed you get dues & payments and your own projects, and
 * nothing else. Printing and borrowing sit behind this because they're the club
 * spending money on you; the management tools because running things is for paid-up
 * members.
 *
 * Presentation only — every route re-checks server-side, and this exists so the rail
 * can grey a link out rather than let somebody click through to a 403. Anything but
 * `ready` reads as unlocked, so nothing flashes a padlock at a paid-up member.
 *
 * `ADMIN` is exempt, here and there: whoever can fix a membership must not be lockable
 * out by one.
 */
export function duesLocked(
  membership: ApiState<ApiMembership>,
  role: UserRole,
): boolean {
  // The boolean face of `accessLock` below, and deliberately not a second read of
  // `hasAccess`: the rail and the page it links to must lock on the same condition or
  // one of them is lying.
  return accessLock(membership, role) !== null
}

/**
 * Why a page is shut, or `null` when it isn't.
 *
 * One predicate with three sentences, mirroring `requireCurrentDues` in
 * `server/src/auth/authz.ts`. There used to be two: `duesLocked` for the management
 * pages and a stricter `memberLocked` that also refused a `GUEST` outright. That
 * mattered while summer reported `hasAccess: true` for everybody. Access is the dues
 * date now, and nothing sets that date without promoting the account in the same
 * transaction — so the role check had become one that could never fail. Two locks that
 * always agree are one lock and a place for them to stop agreeing.
 *
 * There was briefly a fourth reason, `survey`, from when the one-time survey sat in
 * front of dues on the server. It's an invitation now and locks nothing.
 *
 * The three reasons are the difference between telling somebody the club wants money,
 * telling them it doesn't want any right now, and telling somebody two years in that
 * they were never a member:
 *
 *   - `claim` — a free window is running. Quoting a price would be false.
 *   - `dues` — a date that has run out. A member, on hold, nothing taken away.
 *   - `newcomer` — no date, ever, and nothing free on offer.
 */
export type AccessLock = 'claim' | 'dues' | 'newcomer' | null

/**
 * Why this membership isn't cover, ignoring who is looking.
 *
 * Split out from `accessLock` because two callers need the reason without the
 * exemption: the overview's button, which should say CLAIM rather than PAY to an admin
 * who genuinely hasn't claimed, and the join panel on a public project page.
 */
export function coverGap(membership: ApiMembership): AccessLock {
  if (membership.hasAccess) return null
  if (membership.canActivate) return 'claim'

  return membership.paidThrough === null ? 'newcomer' : 'dues'
}

export function accessLock(
  membership: ApiState<ApiMembership>,
  role: UserRole,
): AccessLock {
  // Lock nothing until the standing has actually arrived, so no padlock flashes at a
  // paid-up member while their status is still on the wire.
  if (membership.status !== 'ready' || role === 'ADMIN') return null

  return coverGap(membership.data)
}

/**
 * The words each reason gets, in one place.
 *
 * Every one of these lived somewhere else until the free window stopped granting
 * access on its own. Before that "no cover" only happened when money was owed, so a
 * hardcoded PAY MY DUES was correct wherever it appeared — five pages had one, and all
 * five became wrong on the same day.
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
}

/**
 * Whether to put the survey prompt up over the dashboard.
 *
 * Deliberately not an `AccessLock`. It's in this file because it reads the same
 * membership object and follows the same "nothing until `ready`" rule, and nowhere
 * near `coverGap` because every reason there shuts a page and this one only asks a
 * question. Somebody this returns true for can do everything on the site.
 *
 * No `ADMIN` exemption either: that exists so whoever fixes memberships can't be
 * locked out by one, and there's no lock here to be let past.
 */
export function surveyPrompt(membership: ApiState<ApiMembership>): boolean {
  if (membership.status !== 'ready') return false

  return membership.data.surveyPending && !membership.data.surveyPromptDismissed
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
