import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import type { ApiOfficerMember, ApiPrintOperator, ApiTerm, UserRole } from '../../lib/api/api'
import { stubFetch, stubFetchNetworkError, stubFetchPending, urlOf } from '../../test/stubFetch'
import { OfficerPrintOperatorsPage } from './OfficerPrintOperatorsPage'

/** Letting members run the print queue: the list's states, granting and taking it back. */

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
          <Route path="/" element={<OfficerPrintOperatorsPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

const operator = (over: Partial<ApiPrintOperator> = {}): ApiPrintOperator => ({
  id: 'op1',
  fullName: 'Rowan Chen',
  email: null,
  discordUsername: 'rowan_c',
  grantedAt: '2026-09-10T12:00:00.000Z',
  grantedBy: { fullName: 'Officer Test' },
  active: true,
  ...over,
})

const found: ApiOfficerMember = {
  id: 'm2',
  fullName: 'Sam Okafor',
  email: 'sam@ucf.edu',
  discordUsername: null,
  role: 'MEMBER',
  duesPaidThrough: term.endsAt,
  title: null,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the list', () => {
  it('shows a skeleton while it loads', () => {
    vi.stubGlobal('fetch', stubFetchPending())
    const { container } = renderPage()

    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
  })

  it('says so when it could not load', async () => {
    vi.stubGlobal('fetch', stubFetchNetworkError())
    renderPage()

    expect(await screen.findByText(/couldn't load the operators/i)).toBeInTheDocument()
  })

  it('says when nobody has been let in', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/print-operators': [] }))
    renderPage()

    expect(await screen.findByText(/nobody yet/i)).toBeInTheDocument()
  })

  it('lists operators, and marks one whose dues lapsed', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/officer/print-operators': [
          operator(),
          operator({ id: 'op2', fullName: 'Ada Park', discordUsername: null, active: false }),
        ],
      }),
    )
    renderPage()

    expect(await screen.findByText('Rowan Chen')).toBeInTheDocument()
    expect(screen.getByText(/@rowan_c · since .*, by officer test/i)).toBeInTheDocument()

    const lapsed = screen.getByText('Ada Park').closest('li')!
    expect(within(lapsed).getByText('DUES LAPSED')).toBeInTheDocument()
  })
})

describe('letting someone in', () => {
  it('adds the member the server let in', async () => {
    const stub = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = urlOf(input)
      const body =
        init?.method === 'PUT'
          ? operator({ id: 'm2', fullName: 'Sam Okafor', discordUsername: null })
          : url.includes('/officer/members')
            ? [found]
            : []
      return Promise.resolve(Response.json(body))
    })
    vi.stubGlobal('fetch', stub)
    renderPage()
    await screen.findByText(/nobody yet/i)

    fireEvent.change(screen.getByLabelText('WHO'), { target: { value: 'sam' } })
    fireEvent.click(await screen.findByRole('button', { name: /sam okafor/i }))
    fireEvent.click(screen.getByRole('button', { name: 'LET THEM IN' }))

    expect(await screen.findByText(/sam okafor can run the print queue/i)).toBeInTheDocument()
    expect(stub.mock.calls.some(([input, init]) =>
      init?.method === 'PUT' && urlOf(input).endsWith('/officer/print-operators/m2'),
    )).toBe(true)
    expect(screen.getByRole('button', { name: /remove sam okafor/i })).toBeInTheDocument()
  })

  it('shows the server’s refusal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, init?: RequestInit) =>
        Promise.resolve(
          init?.method === 'PUT'
            ? Response.json(
                { error: 'Sam Okafor hasn’t finished the slicer training yet.' },
                { status: 409 },
              )
            : Response.json(urlOf(input).includes('/officer/members') ? [found] : []),
        ),
      ),
    )
    renderPage()
    await screen.findByText(/nobody yet/i)

    fireEvent.change(screen.getByLabelText('WHO'), { target: { value: 'sam' } })
    fireEvent.click(await screen.findByRole('button', { name: /sam okafor/i }))
    fireEvent.click(screen.getByRole('button', { name: 'LET THEM IN' }))

    expect(await screen.findByText(/hasn’t finished the slicer training/i)).toBeInTheDocument()
  })
})

describe('taking it back', () => {
  it('asks first, then removes them from the list', async () => {
    const stub = vi.fn((_input: string | URL | Request, init?: RequestInit) =>
      Promise.resolve(Response.json(init?.method === 'DELETE' ? { removed: true } : [operator()])),
    )
    vi.stubGlobal('fetch', stub)
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /remove rowan chen/i }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/print crew role/i)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'REMOVE' }))

    await waitFor(() => {
      expect(screen.queryByText('Rowan Chen')).not.toBeInTheDocument()
    })
    expect(screen.getByText(/no longer runs the print queue/i)).toBeInTheDocument()
    // The button pressed is gone, so focus lands on the list rather than the page.
    expect(screen.getByText('OPERATORS', { selector: 'p' })).toHaveFocus()
  })
})

describe('the gate', () => {
  it('turns away somebody who is not on the board', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/print-operators': [] }))
    renderPage(context('MEMBER'))

    expect(await screen.findByText(/this desk belongs to the officers/i)).toBeInTheDocument()
  })
})
