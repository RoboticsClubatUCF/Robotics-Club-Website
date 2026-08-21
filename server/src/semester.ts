import { env } from './env.js'
import { Season } from './generated/prisma/enums.js'

/**
 * When UCF's terms start and end, and what that means for dues.
 *
 * The club's membership year is not the club's to decide — it is the
 * university's, and it moves every year. So the dates come from UCF's own
 * academic calendar feed rather than from a table somebody has to remember to
 * update each August. This is a port of `src/lib/ucfCalendar.ts` and
 * `src/lib/currentSemester.ts` from the previous website, which is where the
 * two non-obvious parts of reading that feed were worked out.
 *
 * Everything the site charges for hangs off three questions:
 *
 *   - Which term are we in? `currentTerm`
 *   - Does anyone owe anything right now? `membershipStanding`
 *   - If they pay today, what have they bought? `coverageFor`
 *
 * The club's rules, in the order they matter:
 *
 *   - **Access is `duesPaidThrough`, and nothing else.** A date in the future
 *     is access; a date in the past, or no date, is none. Only `ADMIN` is
 *     exempt, and that exemption lives in `authz.ts` rather than here. There is
 *     no second way in — no role, no grace, no "well, it is summer". This is
 *     the rule the whole file now serves, and it is what makes the website, the
 *     API and the Discord bot agree by construction rather than by three
 *     matching implementations.
 *   - **Dues run to the end of the term they bought.** $25 buys one, $50 buys
 *     that one and the next dues-bearing one: fall then spring, or spring then
 *     fall.
 *   - **Past halfway through a term, a payment buys the *next* one.** Nobody
 *     should hand over a full term's dues in week eleven for three weeks of
 *     cover. The date still runs continuously, so the rest of the current term
 *     comes along with it — see `purchasableTerm`.
 *   - **The free window is claimed, not given.** It runs from the end of one
 *     dues-bearing term to two weeks into the next, and summer sits inside it,
 *     so one press covers May to September. Claiming sets `duesPaidThrough` to
 *     the day the window shuts; it is not a state anybody is in by default.
 *
 * The last of those changed: the summer and the first fortnight used to grant
 * access to *everybody*, claimed or not, and `hasAccess` was true for the whole
 * club through both. That made "is this person covered" and "is anything owed
 * today" two different questions with two different answers, and every consumer
 * had to know which it wanted. Now there is one.
 */

/** Seasons as UCF's feed spells them; `Season` is how the database does. */
const FEED_SEASON: Record<Season, string> = {
  [Season.SPRING]: 'spring',
  [Season.SUMMER]: 'summer',
  [Season.FALL]: 'fall',
}

/**
 * Fixed dates for a term the feed could not be read for, `[month 0-based, day]`.
 *
 * Approximately right, and approximately right is the point: a dues page that
 * refuses to load because somebody else's calendar server is down is worse than
 * one showing a date a week out. Anything actually charged against a fallback
 * is stored on the payment, so a member keeps the date they were shown even
 * after the real one arrives.
 */
const FALLBACK_START: Record<Season, [number, number]> = {
  [Season.SPRING]: [0, 12], // ~12 January
  [Season.SUMMER]: [4, 18], // ~18 May
  [Season.FALL]: [7, 24], // ~24 August
}

const FALLBACK_END: Record<Season, [number, number]> = {
  [Season.SPRING]: [4, 6], // ~6 May
  [Season.SUMMER]: [7, 7], // ~7 August
  [Season.FALL]: [11, 31], // 31 December
}

/**
 * How UCF tags each term's *primary* session, and the first of the two things
 * this file exists to get right.
 *
 * Spring and fall call theirs `1`; summer's full term is `c`. Without the
 * distinction, summer's six-week A and B sessions and its ten-week D session
 * all match first and summer ends in June instead of early August — which would
 * start charging dues for six weeks that are meant to be free.
 */
const MAIN_SESSION: Record<Season, string> = {
  [Season.SPRING]: '1',
  [Season.SUMMER]: 'c',
  [Season.FALL]: '1',
}

const DAY_MS = 24 * 60 * 60 * 1000

/** A day. UCF publishes calendar corrections; nobody publishes them hourly. */
const CACHE_TTL_MS = DAY_MS

/**
 * How long a term that could *not* be read is remembered as unreadable.
 *
 * A failure has to be cached or it is not really a timeout, it is a multiplier.
 * One dues page asks for four terms, each lookup waits five seconds on a
 * calendar server that is down, and the member watches a spinner for the better
 * part of a minute before being shown the fallback dates the first attempt
 * already knew about. Five minutes is short enough that a brief outage heals on
 * its own and long enough that it stops being on the request path.
 */
const FAILED_TTL_MS = 5 * 60 * 1000

interface FeedEvent {
  summary?: string
  dtstart?: string
  eventSession?: string | null
}

interface Feed {
  terms?: { events?: FeedEvent[] }[]
}

interface CachedTerm {
  events: FeedEvent[]
  fetchedAt: number
  /**
   * Whether the feed answered. A cached empty list left by a 503 must not be
   * mistaken for a term UCF has genuinely published nothing for — they expire
   * on different clocks.
   */
  ok: boolean
}

/**
 * Process-local, and deliberately not in Postgres.
 *
 * The rate-limit windows live in the database because they have to hold across
 * instances — a counter that resets per replica is not a limit. This is the
 * opposite case: it is a read-through cache of a public document that is the
 * same for everybody, so each instance keeping its own copy costs one request a
 * day per instance and removes a table, a query and a failure mode.
 */
const termCache = new Map<string, CachedTerm>()

const cacheKey = (year: number, season: Season) => `${year}-${season}`

/** The three terms of one calendar year, in order. */
export const SEASONS = [Season.SPRING, Season.SUMMER, Season.FALL] as const

/**
 * The terms dues are charged for. Summer is not one of them, which is the whole
 * reason this list is separate from `SEASONS`.
 */
export const PAID_SEASONS = [Season.SPRING, Season.FALL] as const

export interface Term {
  year: number
  season: Season
  /** First day of classes, at the start of that day. */
  startsAt: Date
  /** The last moment of the term's final day — see `endOfDay`. */
  endsAt: Date
  /** False when the dates below are the fallbacks rather than UCF's. */
  fromCalendar: boolean
}

/**
 * The end of the day a date lands on.
 *
 * The feed gives the *start* of the day something happens on, so a term whose
 * last event is "On-Campus Housing Closes" on 13 December ends at midnight on
 * the 13th — which would cut a member off for the whole of the last day they
 * paid for. Membership runs through the end of that day.
 */
function endOfDay(date: Date): Date {
  const end = new Date(date)
  end.setHours(23, 59, 59, 999)
  return end
}

function startOfDay(date: Date): Date {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  return start
}

async function fetchTerm(year: number, season: Season): Promise<CachedTerm> {
  const url = `${env.UCF_CALENDAR_URL}/${year}/${FEED_SEASON[season]}`
  const failed: CachedTerm = { events: [], fetchedAt: Date.now(), ok: false }

  const remember = (entry: CachedTerm) => {
    termCache.set(cacheKey(year, season), entry)
    return entry
  }

  try {
    const response = await fetch(url, {
      // Somebody else's service, and on the request path of the dues page.
      // Without a deadline a hung connection holds the page open until the
      // proxy gives up on it; with one, the fallback dates answer instead.
      signal: AbortSignal.timeout(5_000),
    })

    if (!response.ok) {
      console.warn(
        `ucf calendar: ${year} ${season} returned ${response.status} ${response.statusText}`,
      )
      return remember(failed)
    }

    const feed = (await response.json()) as Feed

    return remember({
      events: feed.terms?.[0]?.events ?? [],
      fetchedAt: Date.now(),
      ok: true,
    })
  } catch (error) {
    console.error(`ucf calendar: ${year} ${season} could not be read`, error)
    return remember(failed)
  }
}

/**
 * Reads already on the wire, keyed the same way the cache is.
 *
 * Without this the cache is a thundering-herd amplifier rather than a shield.
 * A term ages out after a day, and the moment it does every request in flight
 * misses together — a hundred members opening the dues page at the start of a
 * term is a hundred *times four terms* of requests at calendar.ucf.edu inside a
 * second, which is how a club gets itself rate-limited off somebody else's
 * service. Sharing the promise makes that one fetch and ninety-nine awaits.
 */
const inFlight = new Map<string, Promise<CachedTerm>>()

async function eventsFor(year: number, season: Season): Promise<CachedTerm> {
  const key = cacheKey(year, season)
  const cached = termCache.get(key)
  const ttl = cached?.ok ? CACHE_TTL_MS : FAILED_TTL_MS

  if (cached && Date.now() - cached.fetchedAt < ttl) return cached

  const running = inFlight.get(key)
  if (running) return running

  // `finally` rather than `then`: a rejected fetch must clear the slot too, or
  // one failure wedges that term until the process restarts. `fetchTerm`
  // swallows its own errors today; this does not depend on that staying true.
  const request = fetchTerm(year, season).finally(() => {
    inFlight.delete(key)
  })

  inFlight.set(key, request)
  return request
}

/**
 * The date of the first event whose summary contains one of `fragments`,
 * preferring the term's main session.
 *
 * The second thing worth getting right: the feed carries every session of a
 * term, so an unqualified search finds whichever winter-intersession or
 * flex-start row happens to sort first. Preferring `MAIN_SESSION` and only then
 * falling back to any match is what keeps a twelve-week term from ending on a
 * six-week session's last day.
 */
function findDate(
  events: FeedEvent[],
  season: Season,
  ...fragments: string[]
): Date | null {
  for (const fragment of fragments) {
    const match =
      events.find(
        (event) =>
          event.eventSession === MAIN_SESSION[season] &&
          event.summary?.includes(fragment),
      ) ?? events.find((event) => event.summary?.includes(fragment))

    if (match?.dtstart) {
      const date = new Date(match.dtstart)
      if (!Number.isNaN(date.getTime())) return date
    }
  }

  return null
}

const fallback = (
  year: number,
  [month, day]: [number, number],
): Date => new Date(year, month, day)

/** One term, from the feed where it answers and from the fixed dates where it doesn't. */
export async function getTerm(year: number, season: Season): Promise<Term> {
  const { events } = await eventsFor(year, season)

  const start = findDate(events, season, 'Classes Begin')
  // Three candidates in descending order of how well they mark "the term is
  // over for a member": housing closing is the last day anybody is still on
  // campus for it, classes ending is a week before finals, commencement is a
  // ceremony some terms do not list.
  const end = findDate(
    events,
    season,
    'On-Campus Housing Closes',
    'Classes End',
    'Commencement',
  )

  return {
    year,
    season,
    startsAt: startOfDay(start ?? fallback(year, FALLBACK_START[season])),
    endsAt: endOfDay(end ?? fallback(year, FALLBACK_END[season])),
    fromCalendar: start !== null && end !== null,
  }
}

/**
 * The term we are in, or — during a break — the one we are heading into.
 *
 * The cascade is the same one the previous site used, and the behaviour during
 * a break is not an accident: on 20 December this answers "spring", weeks
 * before spring starts. That is what makes the gap between terms free without
 * anything having to special-case it, because everything downstream compares
 * against `startsAt` and finds it is still in the future.
 */
export async function currentTerm(now: Date = new Date()): Promise<Term> {
  const year = now.getFullYear()

  const [spring, summer, fall] = await Promise.all([
    getTerm(year, Season.SPRING),
    getTerm(year, Season.SUMMER),
    getTerm(year, Season.FALL),
  ])

  if (now <= spring.endsAt) return spring
  if (now <= summer.endsAt) return summer
  if (now <= fall.endsAt) return fall

  // Past the end of fall, so the next thing on the calendar is January's.
  return getTerm(year + 1, Season.SPRING)
}

/** The term after `term` that dues are actually charged for. Summer is skipped. */
export function nextPaidTerm(term: Term): { year: number; season: Season } {
  return term.season === Season.FALL
    ? { year: term.year + 1, season: Season.SPRING }
    : { year: term.year, season: Season.FALL }
}

/**
 * The dues-bearing term the calendar is pointing at.
 *
 * Fall and spring are themselves. Summer is not chargeable, so June points at
 * the fall that follows it — the alternative being a page that takes $25 and
 * covers nothing.
 *
 * **This is the term the free window hangs off, and it is deliberately not the
 * term a payment buys.** Those two came apart when payments started rolling
 * forward past halfway: in November a payment buys spring, but the free window
 * does not reopen in November, and folding the halfway rule in here would make
 * it look as though it did. `purchasableTerm` below is the other one.
 */
export async function billableTerm(now: Date = new Date()): Promise<Term> {
  const term = await currentTerm(now)

  return term.season === Season.SUMMER
    ? getTerm(term.year, Season.FALL)
    : term
}

/**
 * Whether a term is more than half over.
 *
 * Measured on the term's own length rather than a fixed number of weeks,
 * because spring, summer and fall are not the same length and UCF moves all
 * three. Before a term starts this is negative, which is the answer that makes
 * buying during an intermission buy the term ahead rather than the one after.
 */
export function pastHalfway(term: Term, now: Date): boolean {
  const midpoint =
    term.startsAt.getTime() + (term.endsAt.getTime() - term.startsAt.getTime()) / 2

  return now.getTime() >= midpoint
}

/**
 * The term a payment made right now actually buys.
 *
 * `billableTerm`, rolled forward one dues-bearing term once the current one is
 * more than half gone. Nobody should pay a full term's dues in week eleven and
 * get three weeks for it, so past the midpoint the money buys the next term
 * instead.
 *
 * **The rest of the current term comes along free, and that is a consequence
 * rather than a second rule.** Coverage is one date running forward, so buying
 * spring in November sets the date to spring's end and November-to-December is
 * inside it. There is no start date on a membership and there should not be:
 * two dates is two things to get wrong, and the club has never wanted to sell
 * somebody a term that has not begun *and* lock them out until it does.
 */
export async function purchasableTerm(now: Date = new Date()): Promise<Term> {
  const term = await billableTerm(now)

  if (!pastHalfway(term, now)) return term

  const next = nextPaidTerm(term)
  return getTerm(next.year, next.season)
}

/**
 * When the free window shuts: two weeks into the dues-bearing term ahead.
 *
 * One continuous window rather than one per free stretch, and that is the whole
 * of it. From the day spring ends to two weeks into fall is a single period —
 * the May gap, all of Summer C, the August gap and fall's opening fortnight —
 * and one claim covers the lot. Summer needs no special case: it is free
 * because it is inside this, not because anything checks for it.
 *
 * Null only for a summer term, which `billableTerm` never returns; the guard is
 * here so that changing `billableTerm` fails loudly instead of quietly opening
 * a window that never shuts.
 */
export function trialEndsAt(term: Term): Date | null {
  if (term.season === Season.SUMMER) return null

  return new Date(term.startsAt.getTime() + env.TRIAL_DAYS * DAY_MS)
}

/**
 * Three states, and only the first of them is access.
 *
 * There used to be a fourth. `TRIAL` meant "inside the opening fortnight" and
 * `FREE` meant "summer or a gap", and both granted access to everybody without
 * anybody claiming anything. They have collapsed into one `FREE` that means
 * something quite different: **not covered, but one press away from it.**
 */
export type MembershipStatus =
  /** Covered today. `duesPaidThrough` is in the future — paid, claimed or granted. */
  | 'ACTIVE'
  /** Not covered, and the free window is running: claiming costs nothing. */
  | 'FREE'
  /** Not covered, and nothing is free. Dues are owed. */
  | 'EXPIRED'

export interface MembershipStanding {
  status: MembershipStatus
  /**
   * Whether the person may use anything today.
   *
   * **Exactly `paidThrough > now`, and that is the point.** It used to be
   * `status !== 'EXPIRED'`, which handed the whole club access every summer and
   * every opening fortnight whether or not they had claimed. One date, one
   * answer — the same one `discordRoles.ts` writes into the guild, so the two
   * cannot disagree.
   */
  hasAccess: boolean
  /** The term now falls in, or the one being counted down to. */
  term: Term
  /**
   * The term a payment made now would buy — `purchasableTerm`, so past the
   * halfway point of the current one this is already the next.
   */
  billable: Term
  /** What `User.duesPaidThrough` says, echoed for callers that only have this. */
  paidThrough: Date | null
  /**
   * When the free window shuts, or null when none is running. Claiming sets
   * `duesPaidThrough` to exactly this, so it is both the deadline and the
   * cover somebody gets for pressing the button.
   */
  freeThrough: Date | null
  /**
   * Dues are owed today: not covered, and nothing free to claim. Exactly
   * `status === 'EXPIRED'`, kept as its own field because every call site
   * reads better for it and because the two demotion paths in
   * `membershipSweep.ts` both turn on this rather than on `hasAccess`.
   */
  duesRequired: boolean
  /**
   * `ACTIVE` because a free window was claimed rather than because dues were
   * paid. The two need different sentences: telling somebody their dues are
   * paid when they have not paid anything is how a member turns up in
   * September expecting to be covered.
   */
  freeActive: boolean
  /**
   * There is a free window running and this person has not claimed it — what
   * the dues page turns into the activate button. Claiming is something
   * somebody does rather than something the calendar does to the whole roster
   * twice a year; see `claimFreeWindow` in `routes/dues.ts`.
   */
  canActivate: boolean
}

/**
 * Where one person stands right now.
 *
 * **One line decides it: `covered`.** Everything else here describes the
 * calendar around that answer — what is on offer, until when, and what a
 * payment would buy — but nothing else grants anything. That is the change
 * this file was rewritten for: `hasAccess` used to be true for the entire club
 * every summer, so the question "may this person do things" and the question
 * "is the club charging today" had different answers and every caller had to
 * know which one it meant.
 *
 * Pure, and one date in: claiming a free window is not a second kind of record
 * to look up, it is `duesPaidThrough` moved to the day the window closes. That
 * is what keeps the club's whole dues year answerable from a date and a clock.
 */
export async function membershipStanding(
  paidThrough: Date | null,
  now: Date = new Date(),
): Promise<MembershipStanding> {
  const term = await currentTerm(now)

  // Two different terms, and conflating them is the bug this pair exists to
  // prevent. The window hangs off the term the calendar points at; the quote
  // hangs off the term a payment would actually buy, which past halfway is the
  // one after. In November those differ by a whole semester.
  const [windowTerm, billable] = await Promise.all([
    billableTerm(now),
    purchasableTerm(now),
  ])

  const windowEnd = trialEndsAt(windowTerm)
  const stillFree = windowEnd !== null && now < windowEnd
  const freeThrough = stillFree ? windowEnd : null

  const covered = paidThrough !== null && paidThrough > now

  /**
   * Covered by a claim rather than by money.
   *
   * Told apart by the date alone, with no second record: claiming lands exactly
   * on `windowEnd`, while paying always reaches a term's `endsAt` — three
   * months further on, and `coverageFor` cannot produce anything shorter. So
   * the comparison survives the calendar corrections UCF publishes rather than
   * turning on an exact match. It moved with the window: claiming used to land
   * on the *first day* of the term and now lands a fortnight in.
   */
  const freeActive = covered && windowEnd !== null && paidThrough <= windowEnd

  const status: MembershipStatus = covered
    ? 'ACTIVE'
    : stillFree
      ? 'FREE'
      : 'EXPIRED'

  return {
    status,
    // The whole rule, and the only place it is written down.
    hasAccess: covered,
    term,
    billable,
    paidThrough,
    freeThrough,
    duesRequired: status === 'EXPIRED',
    freeActive,
    // A window is running and claiming would actually move them forward.
    // Somebody who has already claimed sits exactly on `windowEnd` and is
    // refused a second press; somebody who has paid is months past it.
    canActivate:
      stillFree &&
      windowEnd !== null &&
      (paidThrough === null || paidThrough < windowEnd),
  }
}

export interface Coverage {
  /** The term the money is booked against. */
  term: Term
  /** Every term the payment covers, in order. One for a semester, two for a year. */
  covers: Term[]
  /** The last moment covered. */
  through: Date
}

/**
 * What a plan bought right now would cover.
 *
 * `paidThrough` is taken into account rather than ignored, so buying a second
 * semester while the first is still running extends it instead of buying the
 * same weeks twice. The loop walks forward through dues-bearing terms until it
 * finds one the member is not already covered for; four hops is two academic
 * years, which is further ahead than anyone should be able to pay in one go.
 */
export async function coverageFor(
  plan: 'SEMESTER' | 'YEAR',
  now: Date = new Date(),
  paidThrough: Date | null = null,
): Promise<Coverage> {
  // `purchasableTerm`, not `billableTerm`: past the halfway point of a term the
  // money buys the next one. The hop loop below then walks past anything they
  // already hold, so the two rules compose rather than fight — somebody halfway
  // through fall who already paid for spring buys the fall after.
  let term = await purchasableTerm(now)

  for (let hop = 0; hop < 4; hop++) {
    if (paidThrough === null || paidThrough < term.endsAt) break
    const next = nextPaidTerm(term)
    term = await getTerm(next.year, next.season)
  }

  const covers = [term]

  if (plan === 'YEAR') {
    // Fall then spring, or spring then fall — the pair either way, which is
    // what "a year" means to a club whose year starts in August.
    const next = nextPaidTerm(term)
    covers.push(await getTerm(next.year, next.season))
  }

  const last = covers[covers.length - 1]!

  return {
    term,
    covers,
    // Never shorten what somebody already has. The loop above makes this
    // unreachable in normal use; it is here because "the payment went through
    // and my membership got shorter" is not a bug worth risking on a proof.
    through:
      paidThrough !== null && paidThrough > last.endsAt
        ? paidThrough
        : last.endsAt,
  }
}

/** What a plan costs, in cents. The prices live in configuration, not here. */
export function priceOf(plan: 'SEMESTER' | 'YEAR'): number {
  return plan === 'YEAR' ? env.DUES_YEAR_CENTS : env.DUES_SEMESTER_CENTS
}

/**
 * Warm the cache for the terms that are still ahead, at startup.
 *
 * Not required — every read falls through to a fetch — but it means the first
 * person to open the dues page after a deploy does not pay for the round trip,
 * and it puts a line in the log saying which term the server thinks it is,
 * which is the first thing anyone asks when the answer looks wrong.
 */
export async function primeCalendar(): Promise<void> {
  const now = new Date()
  const year = now.getFullYear()

  await Promise.allSettled(
    [
      ...SEASONS.map((season) => ({ year, season })),
      { year: year + 1, season: Season.SPRING },
    ].map(({ year: y, season }) => fetchTerm(y, season)),
  )

  const term = await currentTerm(now)
  const source = term.fromCalendar
    ? 'calendar.ucf.edu'
    : 'FALLBACK DATES — calendar.ucf.edu could not be read'

  console.log(
    `Term ${term.season} ${term.year}: ${term.startsAt.toDateString()} → ${term.endsAt.toDateString()} (${source})`,
  )
}

/** Drop terms that have finished, so the cache does not grow for ever. */
export function forgetFinishedTerms(now: Date = new Date()): void {
  for (const key of termCache.keys()) {
    const [yearPart, seasonPart] = key.split('-')
    const year = Number(yearPart)
    const season = seasonPart as Season

    if (!FALLBACK_END[season] || Number.isNaN(year)) {
      termCache.delete(key)
      continue
    }

    // Against the fallback rather than the cached dates: this only has to be
    // roughly right, and reading it out of `cached.events` would mean parsing
    // the feed again to decide whether to throw the feed away.
    if (endOfDay(fallback(year, FALLBACK_END[season])) < now) {
      termCache.delete(key)
    }
  }
}

/**
 * Throw the whole cache away.
 *
 * For tests, which pin the clock to a date in a term they have stubbed the feed
 * for: a cached term from the previous test would answer before the stub was
 * ever consulted.
 */
export function clearCalendarCache(): void {
  termCache.clear()
  // Or a read started under the previous test's stub is handed to this one.
  inFlight.clear()
}
