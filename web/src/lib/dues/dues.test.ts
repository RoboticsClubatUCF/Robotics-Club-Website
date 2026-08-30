import { describe, expect, it } from 'vitest'
import { LOCK_COPY, accessLock, coverGap, duesLocked } from './dues'
import type { ApiMembership, ApiTerm } from '../api/api'

/**
 * Why a page is shut, and what it is allowed to say about it.
 *
 * This is one function and a lookup table, which is the point of it existing.
 * Access used to be loose enough that "no cover" only ever happened when money
 * was genuinely owed, so five different pages each hardcoded a PAY MY DUES
 * button and all five were right. Access is the dues date now, so "no cover"
 * also means "the club is charging nothing and you have not claimed it" — and
 * all five became wrong on the same day.
 *
 * The tests below are mostly about the third reason, because the other two were
 * already handled and the third is the one that keeps getting forgotten.
 */

const term: ApiTerm = {
  year: 2026,
  season: 'FALL',
  startsAt: '2026-08-24T04:00:00.000Z',
  endsAt: '2026-12-14T04:59:59.999Z',
  fromCalendar: true,
}

const membership = (over: Partial<ApiMembership> = {}): ApiMembership => ({
  status: 'EXPIRED',
  hasAccess: false,
  duesRequired: true,
  paidThrough: null,
  freeThrough: null,
  term,
  billable: term,
  freeActive: false,
  canActivate: false,
  surveyRequired: false,
  ...over,
})

const ready = (data: ApiMembership) => ({ status: 'ready', data }) as const

describe('coverGap', () => {
  it('is null for anybody covered', () => {
    expect(
      coverGap(membership({ status: 'ACTIVE', hasAccess: true, duesRequired: false })),
    ).toBeNull()
  })

  /**
   * The reason that did not used to exist. Somebody uncovered inside a free
   * window owes nothing — `duesRequired` is false — so anything keying off that
   * reads them as fine, and anything keying off `hasAccess` alone reads them as
   * owing money. Both are wrong, and this is the third answer.
   */
  it('says claim when a free window is running', () => {
    expect(
      coverGap(
        membership({
          status: 'FREE',
          duesRequired: false,
          canActivate: true,
          surveyRequired: false,
          freeThrough: '2026-09-07T04:00:00.000Z',
        }),
      ),
    ).toBe('claim')
  })

  it('tells a lapsed member from a newcomer by the date', () => {
    expect(coverGap(membership({ paidThrough: '2025-12-14T00:00:00.000Z' }))).toBe(
      'dues',
    )
    expect(coverGap(membership({ paidThrough: null }))).toBe('newcomer')
  })

  /**
   * A free window outranks both. Somebody who lapsed in December and is reading
   * this in the January gap is one press from cover, and telling them their
   * dues have lapsed — true, but useless — sends them to a card form for
   * something free.
   */
  it('prefers claim over lapsed when both describe the same person', () => {
    expect(
      coverGap(
        membership({
          status: 'FREE',
          duesRequired: false,
          canActivate: true,
          surveyRequired: false,
          paidThrough: '2025-12-14T00:00:00.000Z',
          freeThrough: '2027-01-25T05:00:00.000Z',
        }),
      ),
    ).toBe('claim')
  })
})

describe('accessLock', () => {
  it('exempts an admin, and locks everybody else the same way', () => {
    expect(accessLock(ready(membership()), 'ADMIN')).toBeNull()
    expect(accessLock(ready(membership()), 'OFFICER')).toBe('newcomer')
    expect(accessLock(ready(membership()), 'MEMBER')).toBe('newcomer')
    expect(accessLock(ready(membership()), 'GUEST')).toBe('newcomer')
  })

  /**
   * Officers are not exempt, and that is a club decision rather than an
   * oversight — worth its own assertion because it is the one people expect to
   * find a loophole for.
   */
  it('does not exempt an officer', () => {
    expect(accessLock(ready(membership()), 'OFFICER')).not.toBeNull()
  })

  it('locks nothing until the standing has arrived', () => {
    expect(accessLock({ status: 'loading' }, 'MEMBER')).toBeNull()
    expect(accessLock({ status: 'error', code: 500 }, 'MEMBER')).toBeNull()
  })

  /** The boolean face and the reason must never disagree. */
  it('agrees with duesLocked in every state', () => {
    const states = [
      membership(),
      membership({ paidThrough: '2025-12-14T00:00:00.000Z' }),
      membership({ status: 'FREE', duesRequired: false, canActivate: true }),
      membership({ status: 'ACTIVE', hasAccess: true, duesRequired: false }),
    ]

    for (const role of ['ADMIN', 'OFFICER', 'MEMBER', 'GUEST'] as const) {
      for (const data of states) {
        expect(duesLocked(ready(data), role)).toBe(
          accessLock(ready(data), role) !== null,
        )
      }
    }
  })
})

describe('LOCK_COPY', () => {
  /**
   * The invariant worth pinning: **the free reason never asks for money.**
   * Every one of these strings started life as a hardcoded PAY MY DUES on some
   * page, and the failure mode when one gets missed is quoting a price for
   * something that is free and one press away.
   */
  it('never asks for payment when membership is free', () => {
    expect(LOCK_COPY.claim.cta).not.toMatch(/pay/i)
    expect(LOCK_COPY.claim.short).not.toMatch(/pay|dues|lapsed/i)
    expect(LOCK_COPY.claim.cta).toMatch(/claim/i)
  })

  it('asks for payment when payment is what is wanted', () => {
    expect(LOCK_COPY.dues.cta).toMatch(/pay/i)
    expect(LOCK_COPY.newcomer.cta).toMatch(/pay/i)
  })

  /** A lapsed member must not be told they were never a member. */
  it('does not tell a lapsed member they have not joined', () => {
    expect(LOCK_COPY.dues.short).toMatch(/lapsed/i)
    expect(LOCK_COPY.dues.short).not.toMatch(/members only/i)
  })
})

/**
 * The fourth reason, and the one that outranks the other three.
 *
 * The member survey is the gate ahead of dues on the server — `requireSurvey`
 * runs as the first statement of `requireCurrentDues` — so it has to be the
 * first branch here too. Getting that order wrong is not cosmetic: it would
 * send somebody to the dues page, which the survey gate refuses, and leave
 * them going in a circle with every click 403ing behind a sentence the page
 * never showed them.
 */
describe('the survey reason', () => {
  it('comes before every other reason', () => {
    expect(coverGap(membership({ surveyRequired: true }))).toBe('survey')
  })

  /**
   * Including `hasAccess`. An officer who granted somebody a term has given
   * them cover and not an answer, so this is a real state rather than a
   * theoretical one — and it is the case that would slip past a check written
   * after the `hasAccess` early return.
   */
  it('outranks cover somebody already has', () => {
    expect(
      coverGap(
        membership({
          status: 'ACTIVE',
          hasAccess: true,
          duesRequired: false,
          surveyRequired: true,
        }),
      ),
    ).toBe('survey')
  })

  it('outranks a free window', () => {
    expect(
      coverGap(
        membership({
          status: 'FREE',
          duesRequired: false,
          canActivate: true,
          surveyRequired: true,
        }),
      ),
    ).toBe('survey')
  })

  it('locks the rail for a member who owes only this', () => {
    const owed = ready(
      membership({
        status: 'ACTIVE',
        hasAccess: true,
        duesRequired: false,
        surveyRequired: true,
      }),
    )

    expect(duesLocked(owed, 'MEMBER')).toBe(true)
    expect(accessLock(owed, 'MEMBER')).toBe('survey')
  })

  /** The same exemption as everything else here, and for the same reason. */
  it('does not apply to an admin', () => {
    expect(accessLock(ready(membership({ surveyRequired: true })), 'ADMIN')).toBeNull()
  })

  /** And nothing flashes while the standing is still on the wire. */
  it('draws nothing until the membership has arrived', () => {
    expect(accessLock({ status: 'loading' }, 'MEMBER')).toBeNull()
  })

  it('has words of its own', () => {
    expect(LOCK_COPY.survey.cta).toMatch(/survey/i)
    // Never a price. Nothing is owed — the club wants two minutes, not $25.
    expect(LOCK_COPY.survey.cta).not.toMatch(/dues|pay/i)
  })
})
