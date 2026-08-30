import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LabPanel } from './LabPanel'
import type { DashboardContext } from './DashboardLayout'
import type { ApiMembership, ApiTerm, ApiUser, UserRole } from '../../lib/api/api'
import { bodyOf, stubFetch, urlOf } from '../../test/stubFetch'

/**
 * The panel is two things stacked, and they are gated differently: the state is
 * for everybody and the switch is for officers. Both halves are asserted here,
 * because the split is the only role branch on the whole overview and the
 * reason it exists is not obvious from the markup.
 */

const userWith = (role: UserRole): ApiUser =>
  ({
    id: 'u1',
    fullName: 'Rowan Chen',
    email: 'rowan@example.com',
    role,
    photoUrl: null,
    photoFocalX: 50,
    photoFocalY: 50,
    photoZoom: 1,
  }) as ApiUser

const term: ApiTerm = {
  year: 2026,
  season: 'FALL',
  startsAt: '2026-08-17T00:00:00.000Z',
  endsAt: '2026-12-11T23:59:59.000Z',
  fromCalendar: true,
}

/**
 * Written out rather than cast through `as`, because `duesLocked` reads more of
 * this than the two obvious fields and a partial fixture would be testing a
 * shape the server never sends.
 */
const membershipWith = (
  fields: Partial<ApiMembership>,
): DashboardContext['membership'] => ({
  status: 'ready',
  data: {
    status: 'ACTIVE',
    hasAccess: true,
    duesRequired: false,
    paidThrough: '2035-01-01T00:00:00.000Z',
    freeThrough: null,
    term,
    billable: term,
    freeActive: false,
    canActivate: false,
    surveyRequired: false,
    ...fields,
  },
})

/** Covered until 2035, so nothing here is locked by the calendar in June. */
const covered = membershipWith({})

const lapsed = membershipWith({
  status: 'EXPIRED',
  hasAccess: false,
  duesRequired: true,
  paidThrough: '2020-01-01T00:00:00.000Z',
})

const closed = {
  open: false,
  changedAt: '2026-08-22T18:00:00.000Z',
  buildingOpen: true,
}

/** Gone ten: the server has already masked `open` and says nobody can flip it. */
const overnight = { ...closed, buildingOpen: false }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('LabPanel', () => {
  it('shows the state to a plain member, and offers them no switch', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/lab': { ...closed, open: true } }))

    render(<LabPanel user={userWith('MEMBER')} membership={covered} />)

    expect(await screen.findByText('Open')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /THE LAB/ }),
    ).not.toBeInTheDocument()
  })

  it('gives an officer the switch, and sends the flip', async () => {
    const fetchMock = stubFetch({ '/lab': closed })
    vi.stubGlobal('fetch', fetchMock)

    render(<LabPanel user={userWith('OFFICER')} membership={covered} />)

    const button = await screen.findByRole('button', { name: 'OPEN THE LAB' })
    fireEvent.click(button)

    // The PATCH, not the GET the panel opened with.
    const [input, init] = fetchMock.mock.calls[1] ?? []
    expect(urlOf(input!)).toContain('/lab')
    expect(init?.method).toBe('PATCH')
    expect(bodyOf(init)).toEqual({ open: true })
  })

  /**
   * The button follows the state, so an open lab offers the opposite. Reading
   * the label as the state rather than as the action is the mistake this
   * arrangement invites, which is why the state is printed above it.
   */
  it('offers to close a lab that is open', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/lab': { ...closed, open: true } }))

    render(<LabPanel user={userWith('ADMIN')} membership={covered} />)

    expect(
      await screen.findByRole('button', { name: 'CLOSE THE LAB' }),
    ).toBeInTheDocument()
  })

  /** An officer with lapsed dues is refused by `requireOfficer` server-side, so
      the switch comes off rather than sitting there waiting to 403. */
  it('takes the switch away from an officer whose dues have lapsed', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/lab': closed }))

    render(<LabPanel user={userWith('OFFICER')} membership={lapsed} />)

    expect(await screen.findByText('Closed')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /THE LAB/ }),
    ).not.toBeInTheDocument()
  })

  it('prints the server’s own refusal when a flip is turned down', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    vi.stubGlobal(
      'fetch',
      vi.fn((_input: string | URL | Request, init?: RequestInit) =>
        Promise.resolve(
          init?.method === 'PATCH'
            ? new Response(JSON.stringify({ error: 'Your dues have lapsed.' }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' },
              })
            : new Response(JSON.stringify(closed), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              }),
        ),
      ),
    )

    render(<LabPanel user={userWith('OFFICER')} membership={covered} />)

    fireEvent.click(await screen.findByRole('button', { name: 'OPEN THE LAB' }))

    expect(await screen.findByText('Your dues have lapsed.')).toBeInTheDocument()
    // And the panel still says what it said — a refused write must not leave
    // the sign claiming something that did not happen.
    expect(screen.getByText('Closed')).toBeInTheDocument()

    consoleError.mockRestore()
  })

  /**
   * The curfew, which refuses everybody rather than this person — so the switch
   * is greyed rather than taken away, and the panel says why. Taking it away
   * would read as the feature having broken; leaving it live would offer a
   * press the server answers 409.
   */
  it('disables the switch overnight and says why', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/lab': overnight }))

    render(<LabPanel user={userWith('OFFICER')} membership={covered} />)

    const button = await screen.findByRole('button', { name: 'OPEN THE LAB' })
    expect(button).toBeDisabled()
    expect(
      screen.getByText(/building is shut between 10pm and 8am/),
    ).toBeInTheDocument()
  })

  /** At that hour *why* is the useful half and *when* is not — "Last changed
      4 hr ago" beside a disabled button explains nothing. */
  it('replaces the timestamp with the reason overnight', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/lab': overnight }))

    render(<LabPanel user={userWith('OFFICER')} membership={covered} />)

    await screen.findByText(/building is shut/)
    expect(screen.queryByText(/Last changed/)).not.toBeInTheDocument()
  })

  /** Never guessed at. A panel that printed "Closed" because the request failed
      is how somebody comes to trust a sign the site never made. */
  it('says it does not know when the read fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )

    render(<LabPanel user={userWith('OFFICER')} membership={covered} />)

    expect(
      await screen.findByText(/couldn't tell whether the lab is open/),
    ).toBeInTheDocument()
    expect(screen.queryByText('Closed')).not.toBeInTheDocument()
    expect(screen.queryByText('Open')).not.toBeInTheDocument()

    consoleError.mockRestore()
  })
})
