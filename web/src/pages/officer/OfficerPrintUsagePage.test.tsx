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
      printOperator: false,
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
const PRINTS: ApiPrintUsage[] = [
  { settledAt: ago(100), grams: 20, projectId: null, filament: 'PLA' },
  { settledAt: now, grams: 12.5, projectId: null, filament: 'PLA' },
  { settledAt: now, grams: 30.25, projectId: 'rover', filament: 'PETG' },
  { settledAt: now, grams: null, projectId: 'rover', filament: 'PETG' },
]
/** One more project print this week, so the totals have three rows to sort. */
const WITH_BLIMP: ApiPrintUsage[] = [
  ...PRINTS,
  { settledAt: now, grams: 8, projectId: 'blimp', filament: 'PLA' },
]

const desk = (prints: ApiPrintUsage[] = PRINTS): ApiPrintUsageDesk => ({
  terms: {
    current: { year: 2026, season: 'FALL', from: ago(60), to: new Date(Date.now() + 60 * DAY).toISOString() },
    last: { year: 2026, season: 'SUMMER', from: ago(150), to: ago(60) },
  },
  projects: [
    { id: 'rover', title: 'Rover' },
    { id: 'blimp', title: 'Blimp' },
  ],
  prints,
})

/** The four figures over the graph, by label. */
const figures = () =>
  Object.fromEntries(
    ['TOTAL', 'PRINTS', 'PERSONAL', 'PROJECTS'].map((term) => [
      term,
      screen.getByText(term, { selector: 'dt' }).nextElementSibling?.textContent,
    ]),
  )
const openWeeks = () => {
  fireEvent.click(screen.getByText(/TOTALS BY WEEK/))
}
const weeks = () => screen.getByRole('table', { name: /per week/i })
const totalsTable = () => screen.getByRole('table', { name: /filament by/i })
const totalsNames = () =>
  within(totalsTable())
    .getAllByRole('rowheader')
    .map((cell) => cell.textContent)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the filament graph', () => {
  it('opens on this semester, in weeks', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/print-usage': desk() }))
    renderPage()

    expect(await screen.findByText('Fall 2026 so far')).toBeInTheDocument()
    expect(figures()).toEqual({
      TOTAL: '42.75 g',
      PRINTS: '3',
      PERSONAL: '12.5 g',
      PROJECTS: '30.25 g',
    })
    expect(screen.getByText('1 with no grams recorded')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'THIS SEMESTER' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('group', { name: /filament per week/i })).toBeInTheDocument()
    // FROM and TO show what the preset covers.
    expect(screen.getByLabelText('FROM')).toHaveValue(toDateInput(new Date(ago(60))))
    expect(screen.getByLabelText('TO')).toHaveValue(toDateInput(new Date()))

    // Only the weeks that had prints.
    openWeeks()
    const rows = within(weeks()).getAllByRole('row')
    expect(rows).toHaveLength(2)
    expect(rows[1]).toHaveTextContent('42.75 g')
  })

  it('switches to last semester and all time without asking again', async () => {
    const stub = stubFetch({ '/officer/print-usage': desk() })
    vi.stubGlobal('fetch', stub)
    renderPage()
    await screen.findByText('Fall 2026 so far')

    fireEvent.click(screen.getByRole('button', { name: 'LAST SEMESTER' }))
    expect(screen.getByText('Summer 2026')).toBeInTheDocument()
    expect(figures()).toEqual({ TOTAL: '20 g', PRINTS: '1', PERSONAL: '20 g', PROJECTS: '0 g' })

    fireEvent.click(screen.getByRole('button', { name: 'ALL TIME' }))
    expect(screen.getByText(/^Since /)).toBeInTheDocument()
    expect(figures()).toMatchObject({ TOTAL: '62.75 g', PRINTS: '4' })

    expect(stub).toHaveBeenCalledTimes(1)
  })

  it('takes a range of its own from FROM and TO', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/print-usage': desk() }))
    renderPage()
    await screen.findByText('Fall 2026 so far')

    const today = toDateInput(new Date())
    fireEvent.change(screen.getByLabelText('FROM'), { target: { value: today } })

    expect(screen.getByText(/^\w{3} \d+, \d{4} to \w{3} \d+, \d{4}$/)).toBeInTheDocument()
    expect(figures()).toMatchObject({ TOTAL: '42.75 g', PRINTS: '3' })
    for (const preset of ['THIS SEMESTER', 'LAST SEMESTER', 'ALL TIME']) {
      expect(screen.getByRole('button', { name: preset })).toHaveAttribute('aria-pressed', 'false')
    }
    // A month or less draws in days.
    expect(screen.getByRole('group', { name: /filament per day/i })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('TO'), { target: { value: toDateInput(new Date(ago(3))) } })
    expect(screen.getByText('FROM is after TO. Pick an earlier start.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('narrows everything to what SHOW and FILAMENT pick', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/print-usage': desk() }))
    renderPage()
    await screen.findByText('Fall 2026 so far')
    const show = (value: string) => {
      fireEvent.change(screen.getByLabelText('SHOW'), { target: { value } })
    }
    const filament = (value: string) => {
      fireEvent.change(screen.getByLabelText('FILAMENT'), { target: { value } })
    }

    expect(
      within(screen.getByLabelText('FILAMENT'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Any filament', 'PETG', 'PLA'])

    show('personal')
    expect(figures()).toEqual({ TOTAL: '12.5 g', PRINTS: '1', PERSONAL: '12.5 g', PROJECTS: '0 g' })
    expect(screen.queryByText(/no grams recorded/)).not.toBeInTheDocument()

    show('project:rover')
    expect(figures()).toMatchObject({ TOTAL: '30.25 g', PRINTS: '2' })
    expect(screen.getByText('1 with no grams recorded')).toBeInTheDocument()

    show('all')
    filament('PLA')
    expect(figures()).toMatchObject({ TOTAL: '12.5 g', PRINTS: '1' })

    show('project:rover')
    expect(
      screen.getByText('No matching prints were finished in Fall 2026 so far.'),
    ).toBeInTheDocument()
  })

  it('totals the range by project or filament, and sorts by any column', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/print-usage': desk(WITH_BLIMP) }))
    renderPage()
    await screen.findByText('Fall 2026 so far')

    // Most grams first.
    expect(totalsNames()).toEqual(['Rover', 'Personal prints', 'Blimp'])

    fireEvent.click(within(totalsTable()).getByRole('button', { name: 'PRINTS' }))
    expect(totalsNames()).toEqual(['Rover', 'Blimp', 'Personal prints'])
    expect(within(totalsTable()).getByRole('columnheader', { name: 'PRINTS' })).toHaveAttribute(
      'aria-sort',
      'descending',
    )

    fireEvent.click(within(totalsTable()).getByRole('button', { name: 'PROJECT' }))
    expect(totalsNames()).toEqual(['Blimp', 'Personal prints', 'Rover'])
    fireEvent.click(within(totalsTable()).getByRole('button', { name: 'PROJECT' }))
    expect(totalsNames()).toEqual(['Rover', 'Personal prints', 'Blimp'])

    fireEvent.click(screen.getByRole('button', { name: 'FILAMENT' }))
    fireEvent.click(within(totalsTable()).getByRole('button', { name: 'GRAMS' }))
    expect(
      within(totalsTable())
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.textContent),
    ).toEqual(['PETG230.25 g', 'PLA220.5 g'])
  })

  it('shows only a row picked in the totals', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/print-usage': desk(WITH_BLIMP) }))
    renderPage()
    await screen.findByText('Fall 2026 so far')

    fireEvent.click(within(totalsTable()).getByRole('button', { name: 'Rover' }))
    expect(screen.getByLabelText('SHOW')).toHaveValue('project:rover')
    expect(figures()).toMatchObject({ TOTAL: '30.25 g' })

    fireEvent.change(screen.getByLabelText('SHOW'), { target: { value: 'all' } })
    fireEvent.click(screen.getByRole('button', { name: 'FILAMENT' }))
    fireEvent.click(within(totalsTable()).getByRole('button', { name: 'PLA' }))
    expect(screen.getByLabelText('FILAMENT')).toHaveValue('PLA')
    expect(figures()).toMatchObject({ TOTAL: '20.5 g', PRINTS: '2' })
  })

  it('shows a week in a tooltip over its column, and moves by keyboard', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/print-usage': desk() }))
    renderPage()
    await screen.findByText('Fall 2026 so far')

    const chart = screen.getByRole('group', { name: /filament per week/i })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    fireEvent.focus(chart)
    const tip = screen.getByRole('tooltip')
    expect(tip).toHaveTextContent(/^Week of .+42\.75 g3 prints12\.5 g personal, 30\.25 g for projects$/)
    expect(chart).toHaveAttribute('aria-describedby', tip.id)

    fireEvent.keyDown(chart, { key: 'ArrowLeft' })
    expect(screen.getByRole('tooltip')).toHaveTextContent(/0 g0 prints$/)

    fireEvent.keyDown(chart, { key: 'End' })
    expect(screen.getByRole('tooltip')).toHaveTextContent('42.75 g3 prints')

    fireEvent.blur(chart)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('folds the weeks away, then lists them five at a time', async () => {
    // A print in each of the last seven weeks.
    const spread: ApiPrintUsage[] = Array.from({ length: 7 }, (_, week) => ({
      settledAt: ago(week * 7),
      grams: 10,
      projectId: null,
      filament: 'PLA',
    }))
    vi.stubGlobal('fetch', stubFetch({ '/officer/print-usage': desk(spread) }))
    renderPage()
    await screen.findByText('Fall 2026 so far')

    const fold = screen.getByText(/TOTALS BY WEEK/).closest('details')
    expect(fold).not.toHaveAttribute('open')
    expect(fold).toHaveTextContent(/TOTALS BY WEEK\s*7/)

    openWeeks()
    expect(within(weeks()).getAllByRole('row')).toHaveLength(6)

    fireEvent.click(screen.getByRole('button', { name: 'LOAD MORE' }))
    expect(within(weeks()).getAllByRole('row')).toHaveLength(8)
    expect(screen.queryByRole('button', { name: 'LOAD MORE' })).not.toBeInTheDocument()
    expect(weeks()).toHaveFocus()
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
