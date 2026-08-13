import type { ApiMembership, ApiTerm, MembershipStatus, UserRole } from './api'
import type { ApiState } from './useApi'

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
  })
}

/** "May 6" — for a date in the term being discussed, where the year is noise. */
export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(LOCALE, {
    month: 'long',
    day: 'numeric',
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
 * `FREE` and `TRIAL` are both "you owe nothing at this moment" and are still
 * separate words, because only one of them has a deadline attached. Telling
 * somebody on a trial that membership is simply free is how they find out
 * otherwise by being turned away at the lab.
 *
 * `ACTIVE` used to read PAID, and that was wrong for a whole season a year: a
 * membership can be active without a payment behind it — the summer and the
 * break between terms cost nothing, and a member who has claimed one of those
 * is as covered as anybody who paid. The word has to be about the membership,
 * not about the money.
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
 * lockable out by one.
 */
export function duesLocked(
  membership: ApiState<ApiMembership>,
  role: UserRole,
): boolean {
  if (membership.status !== 'ready' || role === 'ADMIN') return false
  return !membership.data.hasAccess
}

/**
 * Why 3D printing and equipment are shut, or `null` when they are not —
 * mirroring `requireClubMember` on the server.
 *
 * Stricter than `duesLocked`, and about a different question. Those two pages
 * are the club spending its own money on somebody, so they want a **member**,
 * not merely somebody with an account: a `GUEST` is refused whatever their
 * standing says. Coverage alone would let an account made ten minutes ago order
 * prints, because the summer, the break between terms and the trial fortnight
 * all report `hasAccess: true` for everyone — that is what makes them free, and
 * it is not the same as having joined.
 *
 * The management pages keep using `duesLocked`, because nobody holding a rank
 * is a guest and the only question there is whether they have paid.
 *
 * Two reasons rather than a boolean, because they need opposite sentences. A
 * guest whose dues date has **run out** is a member the sweep demoted, and
 * telling them they are not in the club — after two years in it — would be both
 * wrong and unkind, so they get the dues wording. Everyone else reading as a
 * guest gets the newcomer's: no date at all is somebody the site never
 * promoted, and a date still running on a guest cannot come from paying, so it
 * is an officer's hand-set role and "your dues lapsed" would be plainly false.
 *
 * Mirrors `requireClubMember` in `server/src/authz.ts`, which decides the same
 * three ways.
 */
export type AccessLock = 'dues' | 'guest' | null

export function memberLocked(
  membership: ApiState<ApiMembership>,
  role: UserRole,
  now: number = Date.now(),
): AccessLock {
  // Same as `duesLocked`: lock nothing until the standing has actually
  // arrived, so no padlock flashes at a paid-up member on every page load.
  if (membership.status !== 'ready' || role === 'ADMIN') return null

  if (role === 'GUEST') {
    const { paidThrough } = membership.data
    const lapsed = paidThrough !== null && new Date(paidThrough).getTime() <= now

    return lapsed ? 'dues' : 'guest'
  }

  return membership.data.hasAccess ? null : 'dues'
}

export const STATUS_CHIP: Record<
  MembershipStatus,
  { label: string; className: string }
> = {
  ACTIVE: {
    label: 'ACTIVE',
    className: 'border-success/40 bg-success/10 text-success',
  },
  TRIAL: {
    label: 'FREE TRIAL',
    className: 'border-primary/40 bg-primary/10 text-primary',
  },
  FREE: {
    label: 'NO DUES DUE',
    className: 'border-info/40 bg-info/10 text-info',
  },
  EXPIRED: {
    label: 'DUES UNPAID',
    className: 'border-error/40 bg-error/10 text-error',
  },
}
