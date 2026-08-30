import { prisma } from '../core/db.js'
import { env } from '../core/env.js'
import { Season } from '../generated/prisma/enums.js'

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
 *   - **A payment buys the term it is made in, and stops at its end.** Week
 *     eleven's $25 covers weeks eleven to sixteen and nothing after them. This
 *     is the club's rule and it is deliberately blunt: there is one answer to
 *     "which term is this", `billableTerm`, and no date on which the money
 *     lands somewhere other than where the calendar already says you are.
 *   - **The free window is claimed, not given.** It runs from the end of one
 *     dues-bearing term to three weeks into the next, and summer sits inside it,
 *     so one press covers May to September. Claiming sets `duesPaidThrough` to
 *     the day the window shuts; it is not a state anybody is in by default.
 *
 * The last of those changed: the summer and the opening weeks used to grant
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

/**
 * The club's own dates for a term, when it has set any.
 *
 * Cached the way the feed is, and for a sharper reason: `getTerm` is on the
 * request path of every dues read and of `authz.ts`'s gate, so an uncached
 * lookup here would add a query to nearly every authenticated request on the
 * site. The table has at most a handful of rows and changes when an officer
 * presses a button, so a short window plus an explicit flush on write is the
 * whole of it — `forgetTermOverrides` is that flush, and the officer route
 * calls it.
 *
 * `null` in the map is a remembered *absence*: most terms have no override, and
 * without caching that the common case would be the one that always queries.
 */
interface Override {
  startsAt: Date
  endsAt: Date
  /**
   * The club's own finals week, or null for "we have not said".
   *
   * Independent of the two above: an officer may correct the term dates and
   * leave finals to the feed, or set finals on a term whose dates the feed got
   * right. The route keeps them both-or-neither with each other, not with the
   * term.
   */
  finalsStartsAt: Date | null
  finalsEndsAt: Date | null
  note: string | null
}

const OVERRIDE_TTL_MS = 60 * 1000

let overrides: { at: number; rows: Map<string, Override> } | null = null

/** Drop the cached overrides, so the next read sees what was just written. */
export function forgetTermOverrides(): void {
  overrides = null
}

async function overrideFor(
  year: number,
  season: Season,
): Promise<Override | null> {
  if (!overrides || Date.now() - overrides.at >= OVERRIDE_TTL_MS) {
    // The whole table in one query rather than a row at a time: it is a handful
    // of rows, and `currentTerm` asks about three seasons at once.
    const rows = await prisma.termOverride.findMany({
      select: {
        year: true,
        season: true,
        startsAt: true,
        endsAt: true,
        finalsStartsAt: true,
        finalsEndsAt: true,
        note: true,
      },
    })

    overrides = {
      at: Date.now(),
      rows: new Map(
        rows.map((row) => [
          cacheKey(row.year, row.season),
          {
            startsAt: row.startsAt,
            endsAt: row.endsAt,
            finalsStartsAt: row.finalsStartsAt,
            finalsEndsAt: row.finalsEndsAt,
            note: row.note,
          },
        ]),
      ),
    }
  }

  return overrides.rows.get(cacheKey(year, season)) ?? null
}

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
  /**
   * False when the dates are the fixed fallbacks rather than a real answer.
   *
   * **An override counts as a real answer and sets this true**, which is
   * load-bearing rather than cosmetic: `membershipSweep` and `standingRole`
   * both stand down on fallback dates, on the grounds that guessed dates must
   * not take anybody's membership away. A date an officer typed on purpose is
   * *more* trustworthy than the feed, not less, so it must not read as a guess.
   */
  fromCalendar: boolean
  /** Which of the three sources answered, for a page that wants to say so. */
  overridden: boolean
  /** The note whoever set the override left, if they left one. */
  overrideNote: string | null
  /**
   * Finals week: when the club puts every project on halt.
   *
   * **Null means nobody has said, and nothing is halted** — not "there is no
   * finals week". That distinction is the whole design. `getTerm` will answer
   * from an officer's override, or from the feed's "Classes End", and if
   * neither can it answers null rather than guessing.
   *
   * There is deliberately no fallback here, unlike `startsAt`/`endsAt`, and it
   * is the same rule `fromCalendar` serves: guessed dates must not take
   * something away. Fixed fallback finals dates would silently delete a
   * fortnight of meetings from the public calendar without an officer having
   * asked for it, and the failure would look exactly like a broken calendar.
   * Answering null instead leaves the meetings up and leaves the terms desk
   * saying, in words, that nobody has set one.
   *
   * The two are always null together.
   */
  finalsStartAt: Date | null
  finalsEndAt: Date | null
  /** Which source answered for finals, for the desk that has to say so. */
  finalsSource: 'override' | 'calendar' | null
}

/** Finals as the three sources hand it over, before it reaches a `Term`. */
interface Finals {
  finalsStartAt: Date | null
  finalsEndAt: Date | null
  finalsSource: 'override' | 'calendar' | null
}

const NO_FINALS: Finals = {
  finalsStartAt: null,
  finalsEndAt: null,
  finalsSource: null,
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

/**
 * Finals week from the feed: everything after the last day of classes.
 *
 * "Classes End" is already one of the candidates `getTerm` uses for the end of
 * a term, so the vocabulary here is not a guess about what UCF publishes — it
 * is a string this file has been matching against the real feed all along. The
 * comment on that call says it in as many words: classes ending is a week
 * before finals. This is that week.
 *
 * Finals runs from the start of the day *after* classes end, through whatever
 * `endsAt` the term settled on. That is deliberately generous at the back: the
 * term ends at housing-closing, a few days past the last exam, and a project
 * that stays quiet until the dorms shut is not a bug anybody will report.
 *
 * The guard is what keeps it honest. When `endsAt` itself fell back to "Classes
 * End" — which happens whenever the feed omits housing and commencement — the
 * window would be inverted or empty, and an inverted window that silently
 * matches nothing is worse than no window at all. Answer null and let the desk
 * say so.
 */
function finalsFromFeed(
  events: FeedEvent[],
  season: Season,
  endsAt: Date,
): Finals {
  const classesEnd = findDate(events, season, 'Classes End')
  if (!classesEnd) return NO_FINALS

  const start = startOfDay(new Date(classesEnd.getTime() + DAY_MS))
  if (start >= endsAt) return NO_FINALS

  return {
    finalsStartAt: start,
    finalsEndAt: endsAt,
    finalsSource: 'calendar',
  }
}

/**
 * One term, from three sources in order: what the club has set by hand, then
 * UCF's feed, then the fixed dates in this file.
 *
 * The order is the point. UCF's calendar is somebody else's document — it
 * publishes late, renames the events `findDate` looks for, and occasionally
 * omits a term — and before the override existed the only remedy was editing
 * the constants above and deploying. An officer setting a date on the terms
 * desk is the club saying it knows better, which for its own membership year it
 * does.
 */
export async function getTerm(year: number, season: Season): Promise<Term> {
  const set = await overrideFor(year, season)

  // The club's own finals week outranks the feed's whether or not the club has
  // also moved the term — the two halves of an override are independent, so an
  // officer who corrected only the dates still gets the feed's finals below.
  const setFinals: Finals | null =
    set && set.finalsStartsAt !== null && set.finalsEndsAt !== null
      ? {
          finalsStartAt: startOfDay(set.finalsStartsAt),
          finalsEndAt: endOfDay(set.finalsEndsAt),
          finalsSource: 'override',
        }
      : null

  if (set) {
    return {
      year,
      season,
      // An override with no finals dates leaves finals unanswered rather than
      // reaching for the feed. Reading half the answer from the club and half
      // from UCF is how a term ends up describing a week neither of them meant,
      // and the desk that set these is the same desk that can set the rest.
      ...(setFinals ?? NO_FINALS),
      // Normalised exactly as the feed's dates are, so a term set by hand
      // behaves identically to one read from the calendar — a member's last day
      // runs to the end of it either way.
      startsAt: startOfDay(set.startsAt),
      endsAt: endOfDay(set.endsAt),
      // Deliberately true. See the field's comment: the sweeps stand down on
      // fallback dates, and these are the opposite of a guess.
      fromCalendar: true,
      overridden: true,
      overrideNote: set.note,
    }
  }

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

  const endsAt = endOfDay(end ?? fallback(year, FALLBACK_END[season]))

  return {
    year,
    season,
    startsAt: startOfDay(start ?? fallback(year, FALLBACK_START[season])),
    endsAt,
    fromCalendar: start !== null && end !== null,
    overridden: false,
    overrideNote: null,
    // Against the resolved `endsAt` rather than the raw feed date, so a term
    // whose end came from the fallback still gets a finals week the feed can
    // vouch for the start of.
    ...finalsFromFeed(events, season, endsAt),
  }
}

/** Whether `at` falls inside `term`'s finals week. False when nobody set one. */
export function inFinalsWeek(term: Term, at: Date): boolean {
  if (term.finalsStartAt === null || term.finalsEndAt === null) return false
  return at >= term.finalsStartAt && at <= term.finalsEndAt
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
 * The dues-bearing term the calendar is pointing at — and the only one.
 *
 * Fall and spring are themselves. Summer is not chargeable, so June points at
 * the fall that follows it — the alternative being a page that takes $25 and
 * covers nothing.
 *
 * **This is both the term the free window hangs off and the term a payment
 * buys.** The two came apart once. Payments used to roll forward past a term's
 * halfway point, so in November the money bought spring while the window still
 * belonged to fall, and a second function — `purchasableTerm` — existed only to
 * keep the pair from being confused for each other. The club dropped the
 * rollover: dues buy the semester you are sitting in and end with it. So there
 * is one answer again, and no caller has to know which of two it meant.
 *
 * The cost of that is real and was accepted: somebody paying in the last
 * fortnight of a term pays a full term's dues for a fortnight. The club would
 * rather sell that than explain why an October payment reads as spring.
 */
export async function billableTerm(now: Date = new Date()): Promise<Term> {
  const term = await currentTerm(now)

  return term.season === Season.SUMMER
    ? getTerm(term.year, Season.FALL)
    : term
}

/**
 * When the free window shuts: three weeks into the dues-bearing term ahead.
 *
 * One continuous window rather than one per free stretch, and that is the whole
 * of it. From the day spring ends to three weeks into fall is a single period —
 * the May gap, all of Summer C, the August gap and fall's opening weeks —
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
 * There used to be a fourth. `TRIAL` meant "inside the opening weeks" and
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
   * through every term's opening weeks whether or not they had claimed. One date,
   * one
   * answer — the same one `discordRoles.ts` writes into the guild, so the two
   * cannot disagree.
   */
  hasAccess: boolean
  /** The term now falls in, or the one being counted down to. */
  term: Term
  /**
   * The term a payment made now would buy — `billableTerm`, which is the term
   * `term` falls in, or the fall that summer points at.
   *
   * Still its own field now that the two can only differ over summer, because
   * that is exactly when the dues page needs it: `term` can be a season with no
   * price, and the panel quoting one has to name the term it is quoting for.
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
   * twice a year; see `claimFreeWindow` in `routes/member/dues.ts`.
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
  // One term answers both halves of the dues question now: which window is
  // running, and what a payment would buy. It took two while payments rolled
  // forward past halfway — see `billableTerm` for why it is one again. Only
  // summer separates `billable` from `term`, and both read the same cache.
  const [term, billable] = await Promise.all([
    currentTerm(now),
    billableTerm(now),
  ])

  const windowEnd = trialEndsAt(billable)
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
   * on the *first day* of the term and now lands three weeks in.
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
  // The term they are sitting in, always. The hop loop below is the only thing
  // that moves off it, and only past terms they already hold — somebody paid
  // through fall who buys again in October buys the spring after.
  let term = await billableTerm(now)

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
  const source = term.overridden
    ? 'SET BY THE CLUB — see the terms desk'
    : term.fromCalendar
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
  // And the club's own dates, which sit in front of both.
  forgetTermOverrides()
}
