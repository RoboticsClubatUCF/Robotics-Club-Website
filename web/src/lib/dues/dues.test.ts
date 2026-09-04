import { describe, expect, it } from 'vitest'
import {
  LOCK_COPY,
  accessLock,
  coverGap,
  duesLocked,
  surveyPrompt,
} from './dues'
import type { ApiMembership, ApiTerm } from '../api/api'

/**
 * Why a page is shut, and what it's allowed to say about it.
 *
 * This is one function and a lookup table, which is the point of it existing. Access used to be
 * loose enough that "no cover" only ever happened when money was genuinely owed, so five different
 * pages each hardcoded a PAY MY DUES button and all five were right. Access is the dues date now,
 * so "no cover" also means "the club is charging nothing and you haven't claimed it" — and all
 * five became wrong on the same day.
 *
 * The tests below are mostly about the third reason, because the other two were already handled.
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
  surveyPending: false,
  surveyPromptDismissed: false,
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
 * The survey, which isn't a reason at all.
 *
 * It used to be the fourth and the one that outranked the other three: the server ran
 * `requireSurvey` as the first statement of `requireCurrentDues`, so `coverGap` had to branch on
 * it before `hasAccess` or the browser would offer a page the server then refused. The gate is
 * gone. What's left is `surveyPrompt`, which deliberately isn't an `AccessLock` — every reason
 * above shuts a page, and this one only asks a question.
 */
describe('the survey', () => {
  it('is not a lock reason', () => {
    // Paid up, and the survey not answered. `coverGap` used to return `survey`
    // here — ahead of `hasAccess`, deliberately, because the server refused
    // this person everything.
    expect(
      coverGap(
        membership({
          status: 'ACTIVE',
          hasAccess: true,
          duesRequired: false,
          surveyPending: true,
        }),
      ),
    ).toBeNull()
  })

  /**
   * The case that mattered most, and the reason the gate went. Somebody whose
   * dues have lapsed and who never answered used to be told about the survey;
   * the sentence they get now is the one about the thing they actually owe.
   */
  it('leaves an unanswered survey out of the sentence a lapsed member gets', () => {
    expect(
      coverGap(
        membership({
          status: 'EXPIRED',
          hasAccess: false,
          paidThrough: '2025-12-14T00:00:00.000Z',
          surveyPending: true,
        }),
      ),
    ).toBe('dues')
  })

  it('locks nothing for a paid-up member who has not answered', () => {
    const pending = ready(
      membership({
        status: 'ACTIVE',
        hasAccess: true,
        duesRequired: false,
        surveyPending: true,
      }),
    )

    expect(duesLocked(pending, 'MEMBER')).toBe(false)
    expect(accessLock(pending, 'MEMBER')).toBeNull()
  })

  it('is asked of somebody who has not answered', () => {
    expect(surveyPrompt(ready(membership({ surveyPending: true })))).toBe(true)
  })

  /** The checkbox. One press and the dashboard never raises it again. */
  it('is not asked of somebody who said stop', () => {
    expect(
      surveyPrompt(
        ready(membership({ surveyPending: true, surveyPromptDismissed: true })),
      ),
    ).toBe(false)
  })

  it('is not asked of somebody who answered', () => {
    expect(surveyPrompt(ready(membership({ surveyPending: false })))).toBe(false)
  })

  /**
   * **No `ADMIN` exemption**, unlike every lock reason above it. That exemption
   * exists so whoever fixes memberships cannot be locked out by one, and there
   * is nothing here to be let past — an admin's shirt size is as useful to the
   * club as anybody's.
   */
  it('is asked of an admin like anybody else', () => {
    expect(surveyPrompt(ready(membership({ surveyPending: true })))).toBe(true)
    expect(accessLock(ready(membership({ surveyPending: true })), 'ADMIN')).toBeNull()
  })

  /** And nothing is asked while the standing is still on the wire. */
  it('asks nothing until the membership has arrived', () => {
    expect(surveyPrompt({ status: 'loading' })).toBe(false)
    expect(accessLock({ status: 'loading' }, 'MEMBER')).toBeNull()
  })
})
