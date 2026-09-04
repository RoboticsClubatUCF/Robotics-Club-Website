import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OfficerArchivePage } from './OfficerArchivePage'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import type { ApiArchivedTerm, ApiTerm, UserRole } from '../../lib/api/api'
import { bodyOf, urlOf } from '../../test/stubFetch'

/**
 * The officers desk.
 *
 * The three things worth rendering for are the three the page exists to make possible: entering
 * somebody who has no account, entering the same person twice, and correcting a row that is already
 * there. Everything else on this page is chrome around those.
 *
 * The fourth is the warning on a synced row. Deleting a `DISCORD` term while the person still
 * carries the role means the sweep puts it straight back, and a desk that did not say so is a desk
 * where the button looks broken.
 */

const term: ApiTerm = {
  year: 2035,
  season: 'FALL',
  startsAt: '2035-08-24T04:00:00.000Z',
  endsAt: '2035-12-14T04:59:59.999Z',
  fromCalendar: true,
}

const context = (role: UserRole = 'OFFICER'): DashboardContext => ({
  user: {
    id: 'u1',
    fullName: 'Officer Test',
    email: null,
    slug: null,
    role,
    discordUsername: null,
    photoUrl: null,
    photoFocalX: 50,
    photoFocalY: 50,
    photoZoom: 1,
  },
  projects: { status: 'ready', data: [] },
  reloadProjects: () => Promise.resolve(),
  membership: {
    status: 'ready',
    data: {
      status: 'ACTIVE',
      hasAccess: true,
      duesRequired: false,
      paidThrough: term.endsAt,
      freeThrough: null,
      term,
      billable: term,
      freeActive: false,
      canActivate: false,
      surveyPending: false,
      surveyPromptDismissed: false,
    },
  },
  reloadMembership: () => Promise.resolve(),
})

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

const SEATS = ['PRESIDENT', 'VICE_PRESIDENT', 'TREASURER', 'SECRETARY'] as const

const archived = (over: Partial<ApiArchivedTerm> = {}): ApiArchivedTerm => ({
  id: 't1',
  position: 'PRESIDENT',
  startedAt: '2011-09-01T12:00:00.000Z',
  endedAt: '2012-05-01T12:00:00.000Z',
  endedReason: null,
  source: 'MANUAL',
  fullName: 'Marisol Vega',
  photoUrl: null,
  user: null,
  ...over,
})

/**
 * The desk's own reads and writes. The member picker is stubbed too — it asks
 * as it is typed, and an unstubbed search would reject inside a debounce where
 * nothing can see it.
 */
function stubDesk(
  terms: ApiArchivedTerm[] = [archived()],
  over: Record<string, Promise<Response>> = {},
) {
  return vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = urlOf(input)

    if (init?.method === 'POST') return over.post ?? json(archived(), 201)
    if (init?.method === 'PATCH') return over.patch ?? json(archived())
    if (init?.method === 'DELETE') return over.remove ?? json({ deleted: 't1' })
    if (url.includes('/officer/members')) return json([])
    if (url.includes('/officer/archive')) return json({ seats: SEATS, terms })

    return Promise.reject(new Error(`no stub for ${url}`))
  })
}

const renderPage = (dashboard = context()) =>
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<Outlet context={dashboard} />}>
          <Route path="/" element={<OfficerArchivePage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

const rowFor = (name: string) =>
  screen.getByText(name).closest('li') as HTMLElement

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OfficerArchivePage', () => {
  it('lists the archive under the academic year each term belongs to', async () => {
    vi.stubGlobal('fetch', stubDesk())
    renderPage()

    await screen.findByText('Marisol Vega')
    // August is the cut-over, so a term starting in September 2011 is the
    // 2011–2012 board. An en dash, because it is a range. Twice on the page:
    // the group heading, and the year chip that filters to it.
    expect(screen.getAllByText('2011–2012')).toHaveLength(2)
    // In the row, not on the page: the seat is also a filter chip and an option
    // in the picker, which is three of it.
    expect(
      within(rowFor('Marisol Vega')).getByText(/President/),
    ).toBeInTheDocument()
  })

  /**
   * The state the seat panel on the roles desk cannot draw: a term that has not
   * ended, sitting in a page of ones that have. Said in words rather than left
   * to a blank date, which reads as missing data.
   */
  it('marks a term that has not ended', async () => {
    vi.stubGlobal(
      'fetch',
      stubDesk([archived({ endedAt: null, fullName: 'Still Here' })]),
    )
    renderPage()

    await screen.findByText('Still Here')
    expect(
      within(rowFor('Still Here')).getByText('ON THE BOARD'),
    ).toBeInTheDocument()
  })

  /** Most of the archive has nobody behind it, and the row says so — otherwise
      a missing headshot looks like a load that failed. */
  it('says when a term has no account behind it', async () => {
    vi.stubGlobal('fetch', stubDesk())
    renderPage()

    await screen.findByText('Marisol Vega')
    expect(within(rowFor('Marisol Vega')).getByText(/no account/i)).toBeInTheDocument()
  })

  /**
   * The whole point of the desk: a president from before the site existed, with
   * no account to link and an end date fourteen years in the past.
   */
  it('sends a finished term for somebody with no account', async () => {
    const fetchMock = stubDesk([])
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await screen.findByText(/nothing recorded yet/i)

    fireEvent.change(screen.getByLabelText(/who held it/i), {
      target: { value: 'Dana Okafor' },
    })
    fireEvent.change(screen.getByLabelText(/which seat/i), {
      target: { value: 'TREASURER' },
    })
    fireEvent.change(screen.getByLabelText(/started/i), {
      target: { value: '2009-09-01' },
    })
    fireEvent.change(screen.getByLabelText(/^ended$/i), {
      target: { value: '2010-05-01' },
    })

    fireEvent.click(screen.getByRole('button', { name: /add the term/i }))

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([, init]) => init?.method === 'POST'),
      ).toBe(true)
    })

    const posted = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(bodyOf(posted?.[1])).toMatchObject({
      fullName: 'Dana Okafor',
      userId: null,
      position: 'TREASURER',
      // Midday, not midnight: the archive groups on the month read in UTC, and
      // midnight UTC on 1 September is still August in Orlando.
      startedAt: '2009-09-01T12:00:00Z',
      endedAt: '2010-05-01T12:00:00Z',
    })
  })

  /** A term with no seat is a real state — the sync opens one before anybody
      has been given a chair — so the picker's empty option has to survive. */
  it('sends a null seat rather than an empty string', async () => {
    const fetchMock = stubDesk([])
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await screen.findByText(/nothing recorded yet/i)

    fireEvent.change(screen.getByLabelText(/who held it/i), {
      target: { value: 'No Chair' },
    })
    fireEvent.change(screen.getByLabelText(/started/i), {
      target: { value: '2009-09-01' },
    })
    fireEvent.click(screen.getByRole('button', { name: /add the term/i }))

    await waitFor(() => {
      const posted = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
      expect(bodyOf(posted?.[1])).toMatchObject({ position: null, endedAt: null })
    })
  })

  it('will not send a term with no name or no start date', async () => {
    vi.stubGlobal('fetch', stubDesk([]))
    renderPage()

    await screen.findByText(/nothing recorded yet/i)
    const add = screen.getByRole('button', { name: /add the term/i })
    expect(add).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/who held it/i), {
      target: { value: 'Only A Name' },
    })
    expect(add).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/started/i), {
      target: { value: '2009-09-01' },
    })
    expect(add).toBeEnabled()
  })

  /** Editing opens in place, prefilled — a form that opened empty would be a
      form that blanked the row it was meant to correct. */
  it('opens a row prefilled and patches only that term', async () => {
    const fetchMock = stubDesk()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await screen.findByText('Marisol Vega')
    const row = rowFor('Marisol Vega')
    fireEvent.click(within(row).getByRole('button', { name: 'EDIT' }))

    // Scoped to the row: the add form on the right has the same fields, which
    // is the point of them being one component.
    const name = within(row).getByLabelText(/who held it/i)
    expect(name).toHaveValue('Marisol Vega')

    fireEvent.change(name, { target: { value: 'Marisol Vega-Ruiz' } })
    fireEvent.click(within(row).getByRole('button', { name: /save the term/i }))

    await waitFor(() => {
      const patched = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')
      expect(urlOf(patched?.[0] as string)).toContain('/officer/archive/t1')
      expect(bodyOf(patched?.[1])).toMatchObject({ fullName: 'Marisol Vega-Ruiz' })
    })
  })

  /**
   * Deleting is for a row that should never have existed, and the dialog says
   * so — the normal end of a tenure is an end date, not a deletion.
   */
  it('asks before removing a term, and says what removing means', async () => {
    const fetchMock = stubDesk()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await screen.findByText('Marisol Vega')
    fireEvent.click(within(rowFor('Marisol Vega')).getByRole('button', { name: 'REMOVE' }))

    expect(screen.getByText(/should never have existed/i)).toBeInTheDocument()
    // Nothing has gone yet.
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(
      false,
    )

    fireEvent.click(screen.getByRole('button', { name: /remove it/i }))

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE'),
      ).toBe(true)
    })
  })

  /**
   * The one warning that stops the page looking broken. A synced term deleted
   * while its holder still carries the Discord role comes straight back on the
   * next sweep, and that is the sync working.
   */
  it('warns that a synced open term will be reopened by the sweep', async () => {
    vi.stubGlobal(
      'fetch',
      stubDesk([
        archived({ source: 'DISCORD', endedAt: null, fullName: 'Synced Officer' }),
      ]),
    )
    renderPage()

    await screen.findByText('Synced Officer')
    fireEvent.click(
      within(rowFor('Synced Officer')).getByRole('button', { name: 'REMOVE' }),
    )

    expect(screen.getByText(/next sweep will put it straight back/i)).toBeInTheDocument()
  })

  /** The server's own sentence, not a generic one: it names the incumbent. */
  it('shows what the server said when a seat is already taken', async () => {
    vi.stubGlobal(
      'fetch',
      stubDesk([], {
        post: json({ error: 'Priya Raman still holds that seat.' }, 409),
      }),
    )
    renderPage()

    await screen.findByText(/nothing recorded yet/i)

    fireEvent.change(screen.getByLabelText(/who held it/i), {
      target: { value: 'Usurper' },
    })
    fireEvent.change(screen.getByLabelText(/started/i), {
      target: { value: '2009-09-01' },
    })
    fireEvent.click(screen.getByRole('button', { name: /add the term/i }))

    expect(await screen.findByText(/priya raman still holds that seat/i)).toBeInTheDocument()
  })

  it('says so when the archive will not load, and still offers the form', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, init?: RequestInit) =>
        init?.method === undefined && urlOf(input).includes('/officer/archive')
          ? Promise.reject(new TypeError('Failed to fetch'))
          : json([]),
      ),
    )
    renderPage()

    expect(await screen.findByText(/couldn.t load the archive/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add the term/i })).toBeInTheDocument()
  })

  it('turns a member away without asking the API anything', () => {
    const fetchMock = stubDesk()
    vi.stubGlobal('fetch', fetchMock)
    renderPage(context('MEMBER'))

    expect(screen.getByText(/belongs to the officers/i)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
