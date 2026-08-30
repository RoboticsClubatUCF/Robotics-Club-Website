import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  billableTerm,
  clearCalendarCache,
  coverageFor,
  currentTerm,
  getTerm,
  membershipStanding,
  trialEndsAt,
} from './semester.js'
import { Season } from '../generated/prisma/enums.js'

/**
 * The dues year, with UCF's calendar stubbed.
 *
 * This is the file that decides what a member is charged and until when, so it
 * is the one place where getting the arithmetic wrong costs somebody money
 * rather than a rendering glitch. Every case below is a club rule stated as an
 * assertion: summer is free, the gap between terms is free, a term's first
 * three weeks are free, and $50 buys the two terms that are not.
 *
 * `fetch` is stubbed rather than the module being mocked. The parsing of UCF's
 * feed — preferring the main session, reading the term's *last* event as its
 * end — is half of what this file does, and a mocked `getTerm` would test none
 * of it.
 *
 * Dates are written without a timezone so they parse as local, which is what
 * `startOfDay` and `endOfDay` work in. A term boundary is a *day* here, not an
 * instant, and pinning these to UTC would make the suite pass or fail on where
 * the machine running it happens to be.
 */

/**
 * A term as UCF publishes one, cut down to the events that matter.
 *
 * `classesEnd` is optional and defaults to a week before housing closes, which
 * is roughly what UCF publishes and exactly what finals week hangs off. It does
 * not move `endsAt`: `findDate` prefers "On-Campus Housing Closes" and only
 * falls back to "Classes End", so every assertion below about a term's last day
 * means the same thing it did before this event was in the fixture.
 */
function feed(
  classesBegin: string,
  housingCloses: string,
  session = '1',
  classesEnd = new Date(
    new Date(housingCloses).getTime() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString(),
) {
  return {
    terms: [
      {
        events: [
          {
            summary: 'Classes Begin',
            dtstart: classesBegin,
            eventSession: session,
          },
          {
            summary: 'Classes End',
            dtstart: classesEnd,
            eventSession: session,
          },
          {
            summary: 'On-Campus Housing Closes',
            dtstart: housingCloses,
            eventSession: session,
          },
        ],
      },
    ],
  }
}

/**
 * Two academic years of plausible UCF dates. The exact days do not matter —
 * what matters is that spring runs January to May, summer May to August, and
 * fall August to December, because every rule below is about which of those a
 * date falls in.
 */
const TERMS: Record<string, unknown> = {
  '2026/spring': feed('2026-01-12T08:00:00', '2026-05-06T09:00:00'),
  '2026/summer': feed('2026-05-18T08:00:00', '2026-08-07T09:00:00', 'c'),
  '2026/fall': feed('2026-08-24T08:00:00', '2026-12-13T09:00:00'),
  '2027/spring': feed('2027-01-11T08:00:00', '2027-05-05T09:00:00'),
  '2027/summer': feed('2027-05-17T08:00:00', '2027-08-06T09:00:00', 'c'),
  '2027/fall': feed('2027-08-23T08:00:00', '2027-12-12T09:00:00'),
}

let calls: string[] = []

beforeEach(() => {
  calls = []
  clearCalendarCache()

  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request) => {
      const url = String(input)
      calls.push(url)

      const match = Object.keys(TERMS).find((key) => url.endsWith(key))

      if (!match) {
        return Promise.resolve(new Response('not found', { status: 404 }))
      }

      return Promise.resolve(
        new Response(JSON.stringify(TERMS[match]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearCalendarCache()
})

/** Midday, so nothing turns on a boundary the assertion did not mean to test. */
const at = (iso: string) => new Date(`${iso}T12:00:00`)

describe('reading UCFs calendar', () => {
  it('takes the start and end of a term from the feed', async () => {
    const fall = await getTerm(2026, Season.FALL)

    expect(fall.fromCalendar).toBe(true)
    // The start of the day classes begin...
    expect(fall.startsAt.getMonth()).toBe(7)
    expect(fall.startsAt.getDate()).toBe(24)
    expect(fall.startsAt.getHours()).toBe(0)
    // ...and the *end* of the last day, not its midnight. A member who paid
    // through 13 December is covered on the 13th.
    expect(fall.endsAt.getDate()).toBe(13)
    expect(fall.endsAt.getHours()).toBe(23)
  })

  /**
   * Summer's full term is tagged `c`; its six- and ten-week sub-sessions are
   * not. Matching the wrong one ends summer in June and starts charging dues
   * for six weeks that are meant to be free.
   */
  it('reads summer from its full-term session, not a short one', async () => {
    const summer = await getTerm(2026, Season.SUMMER)

    expect(summer.endsAt.getMonth()).toBe(7)
    expect(summer.endsAt.getDate()).toBe(7)
  })

  /**
   * The dues page cannot go down because somebody else's calendar server did.
   * The fallback dates are approximate and say so — `fromCalendar` is what the
   * page reads to tell the member.
   */
  it('falls back to fixed dates when the feed cannot be read', async () => {
    const term = await getTerm(2031, Season.FALL)

    expect(term.fromCalendar).toBe(false)
    expect(term.startsAt.getMonth()).toBe(7)
    expect(term.endsAt.getMonth()).toBe(11)
  })

  /**
   * A failure has to be cached or it is a multiplier, not a timeout: one dues
   * page asks about several terms, and without this each one waits on its own
   * five-second deadline against a server already known to be down.
   */
  it('does not re-ask for a term it has just failed to read', async () => {
    await getTerm(2031, Season.FALL)
    const afterFirst = calls.length

    await getTerm(2031, Season.FALL)

    expect(calls.length).toBe(afterFirst)
  })

  it('asks UCF once per term and then reads its cache', async () => {
    await getTerm(2026, Season.FALL)
    await getTerm(2026, Season.FALL)
    await getTerm(2026, Season.FALL)

    expect(calls.filter((url) => url.endsWith('2026/fall'))).toHaveLength(1)
  })
})

describe('which term it is', () => {
  it.each([
    ['mid-spring', '2026-02-10', Season.SPRING, 2026],
    ['mid-summer', '2026-06-20', Season.SUMMER, 2026],
    ['mid-fall', '2026-10-05', Season.FALL, 2026],
  ])('calls %s %s', async (_case, day, season, year) => {
    const term = await currentTerm(at(day))

    expect(term.season).toBe(season)
    expect(term.year).toBe(year)
  })

  /**
   * The behaviour during a break is the load-bearing one, and it looks wrong
   * until you see why: on 20 December this answers "spring", weeks before
   * spring begins. That is what makes the gap between terms free without
   * anything having to special-case it — everything downstream compares against
   * `startsAt` and finds it still in the future.
   */
  it('names the term ahead during the winter break', async () => {
    const term = await currentTerm(at('2026-12-20'))

    expect(term.season).toBe(Season.SPRING)
    expect(term.year).toBe(2027)
  })

  it('names the term ahead in the gap between summer and fall', async () => {
    const term = await currentTerm(at('2026-08-15'))

    expect(term.season).toBe(Season.FALL)
    expect(term.year).toBe(2026)
  })

  /** Summer is not chargeable, so money handed over in June buys the fall. */
  it('bills a summer payment against the coming fall', async () => {
    const term = await billableTerm(at('2026-06-20'))

    expect(term.season).toBe(Season.FALL)
    expect(term.year).toBe(2026)
  })
})

describe('who owes what', () => {
  const none = null

  it('charges nobody over the summer, and lets nobody in who has not claimed', async () => {
    const standing = await membershipStanding(none, at('2026-06-20'))

    expect(standing.status).toBe('FREE')
    expect(standing.duesRequired).toBe(false)
    // The line the whole rewrite turns on. `FREE` used to mean "free for
    // everybody, come in"; it now means "free, and one press away". Access is
    // the date and this person has none.
    expect(standing.hasAccess).toBe(false)
    expect(standing.canActivate).toBe(true)
  })

  it('asks nothing between one term ending and the next beginning', async () => {
    const standing = await membershipStanding(none, at('2026-12-20'))

    expect(standing.status).toBe('FREE')
    expect(standing.duesRequired).toBe(false)
  })

  /**
   * The opening weeks are the tail of the same window, not a second one.
   *
   * There used to be a `TRIAL` status here for exactly those weeks, sitting
   * beside `FREE` for the summer and the gaps. One continuous window from the
   * end of one dues-bearing term to three weeks into the next made the split
   * meaningless: it is the same offer, claimable on the same press, and the
   * only thing that ever differed was the sentence on the page.
   */
  it('keeps the window open through the first weeks of a term', async () => {
    const standing = await membershipStanding(none, at('2026-08-30'))

    expect(standing.status).toBe('FREE')
    expect(standing.duesRequired).toBe(false)
    expect(standing.freeThrough).not.toBeNull()
    // Claimable *inside* those weeks, which it was not before — the old
    // `canActivate` was off during the trial because access came free anyway.
    expect(standing.canActivate).toBe(true)
  })

  /**
   * Claiming a free window.
   *
   * The summer used to be free *silently* — the calendar covered everybody,
   * every stale account included, and claiming only changed what the
   * membership read as. Now it is the difference between access and none, and
   * it is still not a second kind of record: it is `duesPaidThrough` moved to
   * the day the window shuts. Everything below is what that one date buys.
   */
  describe('claiming a free window', () => {
    /**
     * What `claimFreeWindow` writes: the day the window shuts, three weeks into
     * the term ahead. It used to be that term's *first* day, back when the weeks
     * after it were free for everybody regardless.
     */
    const claimed = async () =>
      trialEndsAt(await getTerm(2026, Season.FALL)) as Date

    it('reads as active once claimed, without a payment behind it', async () => {
      const standing = await membershipStanding(
        await claimed(),
        at('2026-06-20'),
      )

      expect(standing.status).toBe('ACTIVE')
      // The distinction the panel needs, and it comes from the date alone: a
      // payment always reaches the *end* of a term, three months further on.
      expect(standing.freeActive).toBe(true)
      expect(standing.duesRequired).toBe(false)
      expect(standing.canActivate).toBe(false)
    })

    /** A paid member is never mistaken for a claimed one. */
    it('tells a payment apart from a claim by the date', async () => {
      const fall = await getTerm(2026, Season.FALL)
      const paid = await membershipStanding(fall.endsAt, at('2026-06-20'))

      expect(paid.status).toBe('ACTIVE')
      expect(paid.freeActive).toBe(false)
    })

    /**
     * The whole point of the button, and the reason it can be offered on the
     * page rather than only implied.
     */
    it('is offered right through the window and not a day past it', async () => {
      // The May gap, Summer C, the August gap and fall's opening weeks are
      // one stretch, and one press covers all of it.
      expect((await membershipStanding(none, at('2026-06-20'))).canActivate).toBe(true)
      expect((await membershipStanding(none, at('2026-08-15'))).canActivate).toBe(true)
      expect((await membershipStanding(none, at('2026-08-30'))).canActivate).toBe(true)
      expect((await membershipStanding(none, at('2026-12-20'))).canActivate).toBe(true)
      // Dues are genuinely owed. There is nothing free to claim.
      expect((await membershipStanding(none, at('2026-09-30'))).canActivate).toBe(false)
    })

    /** One press, May to September — the reason the window is not split. */
    it('covers the whole stretch from one claim', async () => {
      const inMay = await membershipStanding(none, at('2026-05-10'))
      const through = inMay.freeThrough

      expect(through).not.toBeNull()

      // Still covered in the August gap and in fall's first weeks, on the
      // strength of a date claimed in May.
      expect((await membershipStanding(through, at('2026-06-20'))).hasAccess).toBe(true)
      expect((await membershipStanding(through, at('2026-08-15'))).hasAccess).toBe(true)
      expect((await membershipStanding(through, at('2026-08-30'))).hasAccess).toBe(true)
      // And out the day it shuts.
      expect((await membershipStanding(through, at('2026-09-30'))).hasAccess).toBe(false)
    })

    /**
     * A claim carries through the opening weeks rather than handing over to
     * them. This is the case that flipped: the date used to stop on the term's
     * first day and let the blanket trial take the weeks after, which only
     * worked while the trial was blanket.
     */
    it('carries straight through the term’s first weeks', async () => {
      const standing = await membershipStanding(
        await claimed(),
        at('2026-08-30'),
      )

      expect(standing.status).toBe('ACTIVE')
      expect(standing.hasAccess).toBe(true)
      expect(standing.freeActive).toBe(true)
      // Already on the last day the window covers, so there is nothing left to
      // claim — the guard against pressing the button twice.
      expect(standing.canActivate).toBe(false)
    })

    /** And once the trial is out, a claim buys nothing more. */
    it('runs out with the window it was claimed for', async () => {
      const standing = await membershipStanding(
        await claimed(),
        at('2026-09-30'),
      )

      expect(standing.status).toBe('EXPIRED')
      expect(standing.freeActive).toBe(false)
      expect(standing.hasAccess).toBe(false)
    })

    /**
     * The rule this whole file was rewritten around, stated as a test so it
     * cannot quietly go back. Free is claimed, not given: somebody who has not
     * pressed the button is not covered, however free the week is.
     */
    it('gates access on having claimed', async () => {
      const unclaimed = await membershipStanding(none, at('2026-06-20'))

      expect(unclaimed.status).toBe('FREE')
      expect(unclaimed.hasAccess).toBe(false)
      expect(unclaimed.canActivate).toBe(true)
    })

    /** Somebody who paid ahead has nothing to claim and is already active. */
    it('has nothing to offer somebody whose dues already cover today', async () => {
      const standing = await membershipStanding(
        new Date('2026-12-13T23:59:59'),
        at('2026-09-30'),
      )

      expect(standing.status).toBe('ACTIVE')
      expect(standing.freeActive).toBe(false)
      expect(standing.canActivate).toBe(false)
    })
  })

  it('starts asking once the trial has run out', async () => {
    const standing = await membershipStanding(none, at('2026-09-30'))

    expect(standing.status).toBe('EXPIRED')
    expect(standing.duesRequired).toBe(true)
    expect(standing.hasAccess).toBe(false)
    expect(standing.freeThrough).toBeNull()
  })

  it('counts somebody whose dues cover today as paid', async () => {
    const standing = await membershipStanding(
      new Date('2026-12-13T23:59:59'),
      at('2026-09-30'),
    )

    expect(standing.status).toBe('ACTIVE')
    expect(standing.duesRequired).toBe(false)
  })

  /**
   * Paid comes before free in the order of tests, and it has to. A member who
   * bought the year still reads as paid through the summer rather than as
   * "nobody owes anything" — they paid for it, and a status that forgets is a
   * status somebody will argue with.
   */
  it('still reads as paid during the free summer', async () => {
    const standing = await membershipStanding(
      new Date('2027-05-05T23:59:59'),
      at('2026-06-20'),
    )

    expect(standing.status).toBe('ACTIVE')
  })

  /** The trial ends on a date the page has to be able to print. */
  it('ends the trial twenty-one days after classes begin', async () => {
    const fall = await getTerm(2026, Season.FALL)
    const ends = trialEndsAt(fall)

    expect(ends).not.toBeNull()
    expect(Math.round((ends!.getTime() - fall.startsAt.getTime()) / 86_400_000)).toBe(21)
  })

  it('has no trial in summer, because summer is free outright', async () => {
    expect(trialEndsAt(await getTerm(2026, Season.SUMMER))).toBeNull()
  })
})

describe('what a payment buys', () => {
  it('covers a semester to the end of the term it was bought in', async () => {
    const coverage = await coverageFor('SEMESTER', at('2026-09-30'))

    expect(coverage.covers).toHaveLength(1)
    expect(coverage.covers[0]!.season).toBe(Season.FALL)
    expect(coverage.through.getMonth()).toBe(11)
    expect(coverage.through.getDate()).toBe(13)
  })

  /** "$50 gives you access to fall and spring..." */
  it('covers fall and the spring after it when bought in fall', async () => {
    const coverage = await coverageFor('YEAR', at('2026-09-30'))

    expect(coverage.covers.map((term) => term.season)).toEqual([
      Season.FALL,
      Season.SPRING,
    ])
    expect(coverage.covers[1]!.year).toBe(2027)
    expect(coverage.through.getFullYear()).toBe(2027)
    expect(coverage.through.getMonth()).toBe(4)
  })

  /** "...or spring and fall if purchasing in spring." */
  it('covers spring and the fall after it when bought in spring', async () => {
    const coverage = await coverageFor('YEAR', at('2026-02-10'))

    expect(coverage.covers.map((term) => term.season)).toEqual([
      Season.SPRING,
      Season.FALL,
    ])
    expect(coverage.covers[1]!.year).toBe(2026)
    expect(coverage.through.getMonth()).toBe(11)
  })

  /** The summer in the middle is free for everyone, so a year is two terms. */
  it('skips the free summer rather than buying it', async () => {
    const coverage = await coverageFor('YEAR', at('2026-02-10'))

    expect(coverage.covers.map((term) => term.season)).not.toContain(
      Season.SUMMER,
    )
  })

  /**
   * Buying a second semester while the first is still running has to extend it,
   * not sell the same weeks twice. This is the case the previous site got
   * wrong — its `validSemester` returned a date hardcoded to 2024.
   */
  it('rolls a second semester forward instead of selling the same one twice', async () => {
    // Taken from the term rather than typed out. `coverageFor` is what sets
    // `duesPaidThrough` in the first place, so the only value a member can
    // actually hold is this one — and a hand-written `23:59:59` is a
    // millisecond short of it, which is a different case entirely: somebody
    // paid up to *most* of fall still has fall left to buy.
    const alreadyPaid = (await getTerm(2026, Season.FALL)).endsAt
    const coverage = await coverageFor('SEMESTER', at('2026-09-30'), alreadyPaid)

    expect(coverage.term.season).toBe(Season.SPRING)
    expect(coverage.term.year).toBe(2027)
    expect(coverage.through.getTime()).toBeGreaterThan(alreadyPaid.getTime())
  })

  /** "The payment went through and my membership got shorter" is never right. */
  it('never shortens cover somebody already has', async () => {
    const farFuture = new Date('2030-01-01T00:00:00')
    const coverage = await coverageFor('SEMESTER', at('2026-09-30'), farFuture)

    expect(coverage.through.getTime()).toBeGreaterThanOrEqual(
      farFuture.getTime(),
    )
  })
})
/**
 * A payment buys the term it was made in, however late in it that is.
 *
 * The club used to roll a late payment forward: past a term's midpoint the $25
 * bought the *next* term and the tail of the current one came along free. That
 * is gone — dues cover the semester you are sitting in and end with it — and
 * this block is the assertion that it stays gone, because the arithmetic that
 * would bring it back is a one-line change nobody would notice in review.
 *
 * The dates are checked against the stubbed calendar rather than guessed: fall
 * 2026 runs 24 August to 13 December, so the old midpoint was around 18
 * October, and spring 2026 runs 12 January to 6 May, midpoint around 9 March.
 * Every case below sits deliberately *past* one of those.
 */
describe('buying late in a term', () => {
  it('buys the term itself in the first half', async () => {
    const term = await billableTerm(at('2026-09-30'))

    expect(term.season).toBe(Season.FALL)
    expect(term.year).toBe(2026)
  })

  /** The case that changed: November is still fall, not the spring after it. */
  it('still buys fall in the second half of fall', async () => {
    const term = await billableTerm(at('2026-11-10'))

    expect(term.season).toBe(Season.FALL)
    expect(term.year).toBe(2026)
  })

  it('still buys spring in the second half of spring', async () => {
    const term = await billableTerm(at('2026-04-01'))

    expect(term.season).toBe(Season.SPRING)
    expect(term.year).toBe(2026)
  })

  /**
   * Cover ends with the term, and the member is out in January.
   *
   * This is the whole change stated once. The same call used to answer May
   * 2027, carrying somebody who paid in November through a spring they never
   * bought.
   */
  it('ends cover at the end of the term it was bought in', async () => {
    const coverage = await coverageFor('SEMESTER', at('2026-11-10'))

    expect(coverage.term.season).toBe(Season.FALL)
    expect(coverage.through.getFullYear()).toBe(2026)
    expect(coverage.through.getMonth()).toBe(11)
    expect(coverage.through.getDate()).toBe(13)

    // December, inside what they bought.
    expect(
      (await membershipStanding(coverage.through, at('2026-12-01'))).hasAccess,
    ).toBe(true)
    // February, past the free weeks spring opens with, and not covered.
    expect(
      (await membershipStanding(coverage.through, at('2027-02-15'))).hasAccess,
    ).toBe(false)
  })

  /**
   * The accepted cost of dropping the rollover, written down as a test so that
   * nobody meets it in production and files it as a bug.
   *
   * Dues bought in the last week of a term buy the last week of a term. The
   * club would rather sell that than explain why a November payment reads as
   * spring; if it ever stops being worth it, the fix is a prorated price, not
   * a second answer to which term this is.
   */
  it('sells the tail of a term for a full term of dues', async () => {
    const coverage = await coverageFor('SEMESTER', at('2026-12-08'))

    expect(coverage.term.season).toBe(Season.FALL)
    expect(coverage.through.getMonth()).toBe(11)
    expect(coverage.through.getDate()).toBe(13)
  })

  /** A year bought late is this term and the next, not the two after it. */
  it('starts a year purchase from the term it was bought in', async () => {
    const coverage = await coverageFor('YEAR', at('2026-11-10'))

    expect(coverage.covers.map((term) => term.season)).toEqual([
      Season.FALL,
      Season.SPRING,
    ])
    expect(coverage.covers[0]!.year).toBe(2026)
    expect(coverage.covers[1]!.year).toBe(2027)
    expect(coverage.through.getFullYear()).toBe(2027)
    expect(coverage.through.getMonth()).toBe(4)
  })

  /**
   * Between terms there is no term to be late in, so the money buys the one
   * ahead. This behaviour is unchanged and it is the reason the rollover could
   * be deleted rather than replaced: `currentTerm` already points at what is
   * coming during a break.
   */
  it('buys the term ahead during an intermission', async () => {
    const august = await billableTerm(at('2026-08-15'))
    expect(august.season).toBe(Season.FALL)
    expect(august.year).toBe(2026)

    const december = await billableTerm(at('2026-12-20'))
    expect(december.season).toBe(Season.SPRING)
    expect(december.year).toBe(2027)
  })

  /** In summer the billable term is the coming fall, which has not started. */
  it('buys the coming fall in summer, not the spring after', async () => {
    const term = await billableTerm(at('2026-06-20'))

    expect(term.season).toBe(Season.FALL)
    expect(term.year).toBe(2026)
  })

  /**
   * **The free window does not reopen in November.** It never did, but it used
   * to take a two-term split inside `membershipStanding` to keep it shut: the
   * window hung off fall while the quote hung off spring, and pointing the
   * window at the term being sold would have advertised free membership from
   * mid-October to late January. One term answers both now, and this is the
   * case that would catch anyone reintroducing the second.
   */
  it('does not offer a free window in the second half of a term', async () => {
    const standing = await membershipStanding(null, at('2026-11-10'))

    expect(standing.status).toBe('EXPIRED')
    expect(standing.canActivate).toBe(false)
    expect(standing.freeThrough).toBeNull()
    // And the quote names the term the money would actually buy.
    expect(standing.billable.season).toBe(Season.FALL)
    expect(standing.billable.year).toBe(2026)
  })
})

/**
 * Finals week: the one thing on the term that is allowed to have no answer.
 *
 * Everything else here falls back — a term whose feed is unreadable still has a
 * start and an end, because a dues page that cannot say when the semester is
 * would be worse than one saying a date a week out. Finals is the opposite
 * case. It only ever *removes* things: a finals week nobody set would delete a
 * fortnight of meetings from the public calendar, and the failure would look
 * exactly like a broken calendar rather than like a missing date. So it stays
 * null, and the terms desk says so in words.
 */
describe('finals week', () => {
  it('runs from the day after classes end to the end of the term', async () => {
    const fall = await getTerm(2026, Season.FALL)

    expect(fall.finalsSource).toBe('calendar')
    // Classes end on the 6th in the fixture (a week before housing closes on
    // the 13th), so finals opens on the 7th at midnight.
    expect(fall.finalsStartAt?.getMonth()).toBe(11)
    expect(fall.finalsStartAt?.getDate()).toBe(7)
    expect(fall.finalsStartAt?.getHours()).toBe(0)
    // And closes with the term itself, which is the end of the 13th.
    expect(fall.finalsEndAt?.getTime()).toBe(fall.endsAt.getTime())
  })

  it('answers nothing rather than guessing when the feed cannot be read', async () => {
    // 2028 is not in the fixture, so the fetch 404s and the fallback dates
    // answer for the term. They must not produce a finals week.
    const term = await getTerm(2028, Season.FALL)

    expect(term.fromCalendar).toBe(false)
    expect(term.finalsStartAt).toBeNull()
    expect(term.finalsEndAt).toBeNull()
    expect(term.finalsSource).toBeNull()
  })

  it('is null together, never half of one', async () => {
    for (const season of [Season.SPRING, Season.SUMMER, Season.FALL]) {
      const term = await getTerm(2026, season)
      expect(term.finalsStartAt === null).toBe(term.finalsEndAt === null)
      expect(term.finalsStartAt === null).toBe(term.finalsSource === null)
    }
  })
})
