import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import type { ApiPrintUsage, ApiPrintUsageDesk, ApiTerm, UserRole } from '../../lib/api/api'
import { toDateInput } from '../../lib/printUsage'
import { stubFetch, stubFetchNetworkError, stubFetchPending } from '../../test/stubFetch'
import { OfficerPrintUsagePage } from './OfficerPrintUsagePage'

/** The filament graph: the numbers it adds up, the readout, and the states around the fetch. */

const term: ApiTerm = {
  year: 2026,
  season: 'FALL',
  startsAt: '2026-08-24T04:00:00.000Z',
  endsAt: '2026-12-14T04:59:59.999Z',
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
      slicerTrained: true,
    },
  },
  reloadMembership: () => Promise.resolve(),
})

const renderPage = (dashboard = context()) =>
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<Outlet context={dashboard} />}>
          <Route path="/" element={<OfficerPrintUsagePage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

const DAY = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()

// This semester began sixty days ago, so it draws in weeks; the prints finished just now land in
// the current week whatever day the suite runs.
const now = new Date().toISOString()
const desk = (prints: ApiPrintUsage[] = [
  { settledAt: ago(100), grams: 20, project: false },
  { settledAt: now, grams: 12.5, project: false },
  { settledAt: now, grams: 30.25, project: true },
  { settledAt: now, grams: null, project: true },
]): ApiPrintUsageDesk => ({
  terms: {
    current: { year: 2026, season: 'FALL', from: ago(60), to: new Date(Date.now() + 60 * DAY).toISOString() },
    last: { year: 2026, season: 'SUMMER', from: ago(150), to: ago(60) },
  },
  prints,
})

const summary = () => screen.getByText(/, from \d+ prints?:/)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the filament graph', () => {
  it('opens on this semester, in weeks', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/print-usage': desk() }))
    renderPage()

    expect(await screen.findByText(/in Fall 2026 so far/)).toHaveTextContent(
      '42.75 g in Fall 2026 so far, from 3 prints: 12.5 g personal, 30.25 g for projects.',
    )
    expect(screen.getByRole('button', { name: 'THIS SEMESTER' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/^Week of /)).toBeInTheDocument()
    expect(screen.getByText(/1 finished print has no grams recorded/)).toBeInTheDocument()
    // FROM and TO show what the preset covers.
    expect(screen.getByLabelText('FROM')).toHaveValue(toDateInput(new Date(ago(60))))
    expect(screen.getByLabelText('TO')).toHaveValue(toDateInput(new Date()))

    // Only the weeks that had prints.
    const rows = within(screen.getByRole('table')).getAllByRole('row')
    expect(rows).toHaveLength(2)
    expect(rows[1]).toHaveTextContent('42.75 g')
  })

  it('switches to last semester and all time without asking again', async () => {
    const stub = stubFetch({ '/officer/print-usage': desk() })
    vi.stubGlobal('fetch', stub)
    renderPage()
    await screen.findByText(/in Fall 2026 so far/)

    fireEvent.click(screen.getByRole('button', { name: 'LAST SEMESTER' }))
    expect(summary()).toHaveTextContent('20 g in Summer 2026, from 1 print: 20 g personal, 0 g for projects.')

    fireEvent.click(screen.getByRole('button', { name: 'ALL TIME' }))
    expect(summary()).toHaveTextContent(/^62\.75 g since .+, from 4 prints:/)

    expect(stub).toHaveBeenCalledTimes(1)
  })

  it('takes a range of its own from FROM and TO', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/print-usage': desk() }))
    renderPage()
    await screen.findByText(/in Fall 2026 so far/)

    const today = toDateInput(new Date())
    fireEvent.change(screen.getByLabelText('FROM'), { target: { value: today } })

    expect(summary()).toHaveTextContent(/^42\.75 g from .+ to .+, from 3 prints:/)
    for (const preset of ['THIS SEMESTER', 'LAST SEMESTER', 'ALL TIME']) {
      expect(screen.getByRole('button', { name: preset })).toHaveAttribute('aria-pressed', 'false')
    }
    // A month or less draws in days.
    expect(screen.getByRole('group', { name: /filament per day/i })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('TO'), { target: { value: toDateInput(new Date(ago(3))) } })
    expect(screen.getByText('FROM is after TO. Pick an earlier start.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('reads out another week from the keyboard', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/print-usage': desk() }))
    renderPage()
    await screen.findByText(/in Fall 2026 so far/)

    const readout = screen.getByText(/^Week of /).parentElement!
    expect(readout).toHaveTextContent('42.75 g · 3 prints')

    const chart = screen.getByRole('group', { name: /filament per week/i })
    fireEvent.keyDown(chart, { key: 'ArrowLeft' })
    expect(readout).toHaveTextContent('0 g · 0 prints')

    fireEvent.keyDown(chart, { key: 'End' })
    expect(readout).toHaveTextContent('42.75 g · 3 prints')
  })

  it('says when nothing was finished', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/print-usage': desk([]) }))
    renderPage()

    expect(
      await screen.findByText('No filament prints were finished in Fall 2026 so far.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'ALL TIME' }))
    expect(screen.getByText('No filament prints were finished yet.')).toBeInTheDocument()
  })

  it('shows a placeholder while it loads, with the range controls off', () => {
    vi.stubGlobal('fetch', stubFetchPending())
    const { container } = renderPage()

    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ALL TIME' })).toBeDisabled()
    expect(screen.getByLabelText('FROM')).toBeDisabled()
  })

  it('says so when the server can’t be reached', async () => {
    vi.stubGlobal('fetch', stubFetchNetworkError())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderPage()

    expect(await screen.findByText(/couldn't load the filament usage/i)).toBeInTheDocument()
  })

  it('turns away somebody who is not on the board, without asking the server', async () => {
    const stub = stubFetch({ '/officer/print-usage': desk() })
    vi.stubGlobal('fetch', stub)
    renderPage(context('MEMBER'))

    expect(await screen.findByText(/this desk belongs to the officers/i)).toBeInTheDocument()
    expect(stub).not.toHaveBeenCalled()
  })
})
