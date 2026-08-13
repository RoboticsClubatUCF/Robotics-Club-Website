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
import { Season } from './generated/prisma/enums.js'

/**
 * The dues year, with UCF's calendar stubbed.
 *
 * This is the file that decides what a member is charged and until when, so it
 * is the one place where getting the arithmetic wrong costs somebody money
 * rather than a rendering glitch. Every case below is a club rule stated as an
 * assertion: summer is free, the gap between terms is free, the first fortnight
 * is free, and $50 buys the two terms that are not.
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

/** A term as UCF publishes one, cut down to the two events that matter. */
function feed(classesBegin: string, housingCloses: string, session = '1') {
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

  it('asks nothing of anybody over the summer', async () => {
    const standing = await membershipStanding(none, at('2026-06-20'))

    expect(standing.status).toBe('FREE')
    expect(standing.duesRequired).toBe(false)
    expect(standing.hasAccess).toBe(true)
  })

  it('asks nothing between one term ending and the next beginning', async () => {
    const standing = await membershipStanding(none, at('2026-12-20'))

    expect(standing.status).toBe('FREE')
    expect(standing.duesRequired).toBe(false)
  })

  /** Two weeks from the first day of classes, for everyone, every term. */
  it('gives everybody the first fortnight of a term free', async () => {
    const standing = await membershipStanding(none, at('2026-08-30'))

    expect(standing.status).toBe('TRIAL')
    expect(standing.duesRequired).toBe(false)
    expect(standing.freeThrough).not.toBeNull()
  })

  /**
   * Claiming a free window.
   *
   * The summer used to be free *silently* — the calendar covered everybody,
   * every stale account included. Claiming makes "active member over the
   * summer" a thing somebody did, and it is not a second kind of record: it is
   * `duesPaidThrough` moved to the day the billable term opens. Everything
   * below is what that one date buys.
   */
  describe('claiming a free window', () => {
    /** What `claimFreeWindow` writes: the first day of the term ahead. */
    const claimed = async () => (await getTerm(2026, Season.FALL)).startsAt

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
    it('is offered over the summer and between terms, and not once the term is on', async () => {
      expect((await membershipStanding(none, at('2026-06-20'))).canActivate).toBe(true)
      expect((await membershipStanding(none, at('2026-12-20'))).canActivate).toBe(true)
      // Inside the term: the trial has its own words and its own deadline, and
      // the club asked for this on the summer and the gaps.
      expect((await membershipStanding(none, at('2026-08-30'))).canActivate).toBe(false)
      // Dues are genuinely owed. There is nothing free to claim.
      expect((await membershipStanding(none, at('2026-09-30'))).canActivate).toBe(false)
    })

    /**
     * The reason the date is the term's *first day* rather than the end of the
     * trial that follows it: claiming the summer must not swallow the two free
     * weeks everybody gets in September.
     */
    it('hands over to the trial when the term opens', async () => {
      const standing = await membershipStanding(
        await claimed(),
        at('2026-08-30'),
      )

      expect(standing.status).toBe('TRIAL')
      expect(standing.duesRequired).toBe(false)
      expect(standing.freeThrough).not.toBeNull()
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
     * Not having pressed a button has never been a reason to turn somebody away
     * from the lab: the club's rule is that the window is free for everybody,
     * and claiming changes what the membership reads as, not what it opens.
     */
    it('does not gate access on having claimed', async () => {
      const unclaimed = await membershipStanding(none, at('2026-06-20'))

      expect(unclaimed.status).toBe('FREE')
      expect(unclaimed.hasAccess).toBe(true)
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
  it('ends the trial fourteen days after classes begin', async () => {
    const fall = await getTerm(2026, Season.FALL)
    const ends = trialEndsAt(fall)

    expect(ends).not.toBeNull()
    expect(Math.round((ends!.getTime() - fall.startsAt.getTime()) / 86_400_000)).toBe(14)
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
