import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MembershipPanel } from './MembershipPanel'
import type { ApiMembership, ApiTerm, MembershipStatus } from '../../lib/api'

/**
 * The four states a member can be in, and the fact that they are four rather
 * than two.
 *
 * `FREE` and `TRIAL` look identical from the member's side today — both mean
 * "you owe nothing right now" — and only one of them has a date on which that
 * stops. The test that matters here is that the trial says so: somebody told
 * membership is simply free finds out otherwise at the lab door.
 */

const NOW = new Date('2026-09-01T12:00:00').getTime()

const fall: ApiTerm = {
  year: 2026,
  season: 'FALL',
  startsAt: '2026-08-24T04:00:00.000Z',
  endsAt: '2026-12-14T04:59:59.999Z',
  fromCalendar: true,
}

const summer: ApiTerm = {
  year: 2026,
  season: 'SUMMER',
  startsAt: '2026-05-18T04:00:00.000Z',
  endsAt: '2026-08-08T03:59:59.999Z',
  fromCalendar: true,
}

function membership(over: Partial<ApiMembership> = {}): ApiMembership {
  return {
    status: 'EXPIRED' as MembershipStatus,
    hasAccess: false,
    duesRequired: true,
    paidThrough: null,
    freeThrough: null,
    term: fall,
    billable: fall,
    freeActive: false,
    canActivate: false,
    ...over,
  }
}

const show = (over: Partial<ApiMembership> = {}) =>
  render(<MembershipPanel membership={membership(over)} now={NOW} />)

describe('MembershipPanel', () => {
  it('says when a paid membership runs to', () => {
    show({
      status: 'ACTIVE',
      hasAccess: true,
      duesRequired: false,
      paidThrough: '2026-12-14T04:59:59.999Z',
    })

    // ACTIVE, not PAID. A membership can be active with no payment behind it —
    // the summer and the break between terms cost nothing — so the chip has to
    // be about the membership rather than about the money.
    expect(screen.getByText('ACTIVE')).toBeInTheDocument()
    // And beside it the date it runs to, not the name of the term. Somebody
    // reading their own membership knows what semester it is; what they came
    // to find out is when it stops.
    expect(screen.getByText('UNTIL DECEMBER 13, 2026')).toBeInTheDocument()
    expect(screen.queryByText('FALL 2026')).not.toBeInTheDocument()
    expect(screen.getByText(/your dues are paid/i)).toBeInTheDocument()
    expect(screen.getByText(/December 13, 2026/)).toBeInTheDocument()
  })

  /**
   * The other way of being active: a claimed free window. Its own sentence,
   * because the paid one would be a lie — nothing has been paid, and a member
   * who reads "your dues are paid" in July turns up in September expecting to
   * be covered.
   */
  it('does not claim a payment behind a claimed free summer', () => {
    show({
      status: 'ACTIVE',
      hasAccess: true,
      duesRequired: false,
      // A claimed window *is* a `paidThrough` — the same date the window shuts.
      // It used to be null here, back when claiming only moved somebody to the
      // first day of the term and the blanket trial covered the rest; a
      // fixture with no date is a state that can no longer occur.
      paidThrough: '2026-09-07T04:00:00.000Z',
      freeThrough: '2026-09-07T04:00:00.000Z',
      term: summer,
      freeActive: true,
    })

    expect(screen.getByText('ACTIVE')).toBeInTheDocument()
    expect(screen.getByText(/your membership is active/i)).toBeInTheDocument()
    expect(screen.queryByText(/your dues are paid/i)).not.toBeInTheDocument()
    // And it still names the date the free run ends, like every other state.
    expect(screen.getByText(/September 7/)).toBeInTheDocument()
  })

  /**
   * `FREE` reversed meaning, and this is the pair of tests that pins it.
   *
   * It used to be "the club is charging nobody, so you are covered" — and the
   * panel said "Summer is free" and left it there. Access is the dues date now,
   * so the same status means "the club is charging nobody and you are *still*
   * not covered". Somebody who reads "summer is free" and then cannot open the
   * print page has been told the wrong thing, so the lead line has to be about
   * them rather than about the calendar.
   */
  it('says free membership is unclaimed rather than that summer is free', () => {
    show({
      status: 'FREE',
      hasAccess: false,
      duesRequired: false,
      canActivate: true,
      term: summer,
      billable: fall,
      freeThrough: '2026-09-07T04:00:00.000Z',
    })

    // The chip and the lead line deliberately say the same thing, so this asks
    // for both rather than one ambiguously.
    expect(screen.getAllByText(/free to claim/i)).toHaveLength(2)
    expect(
      screen.getByText(/your membership is free to claim/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/still has to be switched on/i)).toBeInTheDocument()
    // And it does not say the old thing, which read as "you are covered".
    expect(screen.queryByText(/^Summer is free\.$/)).not.toBeInTheDocument()
    expect(screen.getByText(/Fall 2026/)).toBeInTheDocument()
  })

  /**
   * The deadline is the urgent half of that state. A window shutting in six
   * days is the one place on this page where waiting costs something, and a
   * bare date does not read as urgent in August.
   */
  it('counts down to the window shutting, not just naming the date', () => {
    show({
      status: 'FREE',
      hasAccess: false,
      duesRequired: false,
      canActivate: true,
      term: summer,
      billable: fall,
      // Fourteen days from 24 August, and six days after the pinned "now".
      freeThrough: '2026-09-07T04:00:00.000Z',
    })

    expect(screen.getByText(/in 6 days/)).toBeInTheDocument()
    expect(screen.getByText(/September 7/)).toBeInTheDocument()
  })

  /**
   * The chip is the shortest thing on the panel and the most likely to be read
   * alone. It said "FREE UNTIL 7 September", which is a sentence about cover
   * somebody holds — and in this state they hold none. A deadline, not cover.
   */
  it('gives the free state a deadline rather than a run of cover', () => {
    show({
      status: 'FREE',
      hasAccess: false,
      duesRequired: false,
      canActivate: true,
      term: summer,
      billable: fall,
      freeThrough: '2026-09-07T04:00:00.000Z',
    })

    expect(screen.getByText(/^CLAIM BY /)).toBeInTheDocument()
    expect(screen.queryByText(/FREE UNTIL/)).not.toBeInTheDocument()
  })

  it('is plain about an unpaid semester', () => {
    show()

    expect(screen.getByText('DUES UNPAID')).toBeInTheDocument()
    expect(
      screen.getByText(/dues are not paid for this semester/i),
    ).toBeInTheDocument()
  })

  /**
   * A member planning around a date that turns out to be a week off has been
   * misled by a detail nobody mentioned. When UCF's calendar could not be read,
   * the panel says the dates are approximate.
   */
  it('admits when the dates are its own fallbacks rather than UCFs', () => {
    show({ billable: { ...fall, fromCalendar: false } })

    expect(
      screen.getByText(/academic calendar could not be reached/i),
    ).toBeInTheDocument()
  })

  it('says nothing of the sort when the dates came from UCF', () => {
    show()

    expect(
      screen.queryByText(/academic calendar could not be reached/i),
    ).not.toBeInTheDocument()
  })
})
