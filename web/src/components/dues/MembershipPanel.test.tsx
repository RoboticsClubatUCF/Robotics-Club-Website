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
      paidThrough: null,
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
   * The deadline is the whole content of this state. A trial notice with no
   * date on it is the version of this panel that generates the questions it
   * was built to answer.
   */
  it('puts a deadline on the free trial rather than only naming it', () => {
    show({
      status: 'TRIAL',
      hasAccess: true,
      duesRequired: false,
      // Fourteen days from 24 August, and six days after the pinned "now".
      freeThrough: '2026-09-07T04:00:00.000Z',
    })

    expect(screen.getByText('FREE TRIAL')).toBeInTheDocument()
    expect(screen.getByText(/in 6 days/)).toBeInTheDocument()
    expect(screen.getByText(/September 7/)).toBeInTheDocument()
  })

  /**
   * "...and you can pay for the semester or the year at any point before then
   * rather than waiting for it to run out." The offer belongs in the words as
   * well as in the button underneath.
   */
  it('tells somebody on a trial they can pay before it runs out', () => {
    show({
      status: 'TRIAL',
      hasAccess: true,
      duesRequired: false,
      freeThrough: '2026-09-07T04:00:00.000Z',
    })

    expect(screen.getByText(/pay for the semester or the year/i)).toBeInTheDocument()
  })

  it('says summer is free, and when that stops being true', () => {
    show({
      status: 'FREE',
      hasAccess: true,
      duesRequired: false,
      term: summer,
      billable: fall,
      freeThrough: '2026-09-07T04:00:00.000Z',
    })

    expect(screen.getByText('NO DUES DUE')).toBeInTheDocument()
    expect(screen.getByText(/Summer is free/i)).toBeInTheDocument()
    expect(screen.getByText(/Fall 2026/)).toBeInTheDocument()
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
