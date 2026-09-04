import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OfficerSemestersPage } from './OfficerSemestersPage'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import type { ApiSemesterTerm, ApiTerm, UserRole } from '../../lib/api/api'
import { bodyOf, urlOf } from '../../test/stubFetch'

/**
 * The semesters desk.
 *
 * What it is *for* is the thing worth testing: telling a fact from a guess. The
 * site falls back to fixed dates when UCF's calendar cannot be read, and before
 * this page there was no way to see that had happened — so the source label on
 * each row carries most of the page's value, and the reset button only exists
 * where there is something to undo.
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

const season = (
  name: ApiSemesterTerm['season'],
  source: ApiSemesterTerm['source'],
  over: Partial<ApiSemesterTerm> = {},
): ApiSemesterTerm => ({
  year: 2035,
  season: name,
  startsAt: '2035-01-13T05:00:00.000Z',
  endsAt: '2035-05-06T03:59:59.999Z',
  source,
  // Null by default, which is the state the desk has to say something about:
  // nobody has set finals and nothing is on halt.
  finalsStartAt: null,
  finalsEndAt: null,
  finalsSource: null,
  note: null,
  ...over,
})

const YEAR = new Date().getFullYear()

/** The three terms, plus whatever a write should answer with. */
function stubDesk(
  terms: ApiSemesterTerm[] = [
    season('SPRING', 'calendar'),
    season('SUMMER', 'fallback'),
    season('FALL', 'override', { note: 'UCF published late' }),
  ],
  over: Record<string, unknown> = {},
) {
  return vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = urlOf(input)

    if (init?.method === 'PUT') {
      return (over.put as Promise<Response> | undefined) ?? json({})
    }
    if (init?.method === 'DELETE') {
      return (over.remove as Promise<Response> | undefined) ?? json({ removed: 1 })
    }
    // Stamped with the year that was actually asked for, the way the route is:
    // the page shows one year at a time and the arrows change which, so a stub
    // answering a fixed year would make the arrows look broken.
    const asked = /\/officer\/semesters\/(\d+)/.exec(url)?.[1]
    if (asked) {
      return json(terms.map((row) => ({ ...row, year: Number(asked) })))
    }

    return Promise.reject(new Error(`no stub for ${url}`))
  })
}

const renderPage = (dashboard = context()) =>
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<Outlet context={dashboard} />}>
          <Route path="/" element={<OfficerSemestersPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

const rowFor = (label: string) =>
  screen.getByText(label).closest('li') as HTMLElement

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OfficerSemestersPage', () => {
  /**
   * The point of the page. A term the site is guessing at and one UCF actually
   * answered look identical without this, and only one of them is a reason to
   * touch anything.
   */
  it('says where each term got its dates', async () => {
    vi.stubGlobal('fetch', stubDesk())
    renderPage()
    await screen.findByText(`Spring ${String(YEAR)}`)

    expect(within(rowFor(`Spring ${String(YEAR)}`)).getByText(/FROM UCF/)).toBeInTheDocument()
    expect(within(rowFor(`Summer ${String(YEAR)}`)).getByText(/GUESSED/)).toBeInTheDocument()
    expect(
      within(rowFor(`Fall ${String(YEAR)}`)).getByText(/SET BY THE CLUB/),
    ).toBeInTheDocument()
  })

  it('prints the note whoever set an override left', async () => {
    vi.stubGlobal('fetch', stubDesk())
    renderPage()
    await screen.findByText(`Fall ${String(YEAR)}`)

    expect(screen.getByText(/UCF published late/)).toBeInTheDocument()
  })

  /**
   * Only where there is something to undo. A reset button on a term nobody has
   * touched would suggest UCF's own dates can be cleared, which they cannot.
   */
  it('offers to hand a term back only where the club has overridden it', async () => {
    vi.stubGlobal('fetch', stubDesk())
    renderPage()
    await screen.findByText(`Fall ${String(YEAR)}`)

    expect(
      within(rowFor(`Fall ${String(YEAR)}`)).getByRole('button', { name: /use ucf/i }),
    ).toBeInTheDocument()
    expect(
      within(rowFor(`Spring ${String(YEAR)}`)).queryByRole('button', {
        name: /use ucf/i,
      }),
    ).not.toBeInTheDocument()
  })

  it('sends the dates it was given, to the term it was opened on', async () => {
    const fetchMock = stubDesk()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await screen.findByText(`Summer ${String(YEAR)}`)

    fireEvent.click(
      within(rowFor(`Summer ${String(YEAR)}`)).getByRole('button', {
        name: /set dates/i,
      }),
    )

    fireEvent.change(screen.getByLabelText(/first day/i), {
      target: { value: '2035-05-12' },
    })
    fireEvent.change(screen.getByLabelText(/last day/i), {
      target: { value: '2035-08-02' },
    })
    fireEvent.submit(screen.getByRole('button', { name: /save dates/i }).closest('form')!)

    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(put).toBeDefined()
    expect(urlOf(put![0])).toContain(`/officer/semesters/${String(YEAR)}/SUMMER`)
    expect(bodyOf(put![1])).toMatchObject({
      startsAt: '2035-05-12',
      endsAt: '2035-08-02',
    })
  })

  /**
   * Checked in the form as well as on the server. The server refuses it with a
   * zod report, which is a debugging aid rather than something to put in front
   * of an officer — so the sentence they actually read has to be this one.
   */
  it('refuses a term that ends before it starts, without asking the server', async () => {
    const fetchMock = stubDesk()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await screen.findByText(`Spring ${String(YEAR)}`)

    fireEvent.click(
      within(rowFor(`Spring ${String(YEAR)}`)).getByRole('button', {
        name: /set dates/i,
      }),
    )
    fireEvent.change(screen.getByLabelText(/first day/i), {
      target: { value: '2035-05-01' },
    })
    fireEvent.change(screen.getByLabelText(/last day/i), {
      target: { value: '2035-01-01' },
    })

    expect(screen.getByText(/has to end after it starts/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save dates/i })).toBeDisabled()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
  })

  /** The form opens on whatever is in force, so correcting UCF by three days is
      an edit rather than typing both dates out. */
  it('opens the form on the dates already in force', async () => {
    vi.stubGlobal('fetch', stubDesk())
    renderPage()
    await screen.findByText(`Spring ${String(YEAR)}`)

    fireEvent.click(
      within(rowFor(`Spring ${String(YEAR)}`)).getByRole('button', {
        name: /set dates/i,
      }),
    )

    expect(screen.getByLabelText(/first day/i)).toHaveValue('2035-01-13')
  })

  /** Handing a term back is destructive enough to confirm, and the dialog says
      what actually happens to it. */
  it('confirms before handing a term back to UCF', async () => {
    const fetchMock = stubDesk()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await screen.findByText(`Fall ${String(YEAR)}`)

    fireEvent.click(
      within(rowFor(`Fall ${String(YEAR)}`)).getByRole('button', { name: /use ucf/i }),
    )

    expect(screen.getByText(/hand fall/i)).toBeInTheDocument()
    // Nothing sent until it is confirmed.
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: "USE UCF'S DATES" }))

    const removed = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE')
    expect(urlOf(removed![0])).toContain(`/officer/semesters/${String(YEAR)}/FALL`)
  })

  it('moves between years', async () => {
    const fetchMock = stubDesk()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await screen.findByText(`Spring ${String(YEAR)}`)

    fireEvent.click(screen.getByRole('button', { name: /next year/i }))

    await screen.findByText(`Spring ${String(YEAR + 1)}`)
    expect(
      fetchMock.mock.calls.some(([input]) =>
        urlOf(input).includes(`/officer/semesters/${String(YEAR + 1)}`),
      ),
    ).toBe(true)
  })

  /** Every check on the page is presentation; the server re-checks. But a
      member who finds the URL should be told, not shown an empty desk. */
  it('keeps the desk to officers and admins', () => {
    vi.stubGlobal('fetch', stubDesk())

    renderPage(context('MEMBER'))
    expect(screen.getByText(/belongs to the officers/i)).toBeInTheDocument()
  })

  it('lets an admin in', async () => {
    vi.stubGlobal('fetch', stubDesk())

    renderPage(context('ADMIN'))
    expect(await screen.findByText(`Spring ${String(YEAR)}`)).toBeInTheDocument()
  })

  it('says so when the year cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )

    renderPage()

    expect(await screen.findByText(/couldn.t load that year/i)).toBeInTheDocument()
  })
})
