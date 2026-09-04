import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OfficerSurveyPage } from './OfficerSurveyPage'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import type { ApiSurveySummary, ApiTerm, UserRole } from '../../lib/api/api'
import { stubFetch, stubFetchNetworkError } from '../../test/stubFetch'

/**
 * The survey desk.
 *
 * What it is for is placing an order, so the thing worth pinning is that a count of nought is still
 * printed. A tally that quietly drops the sizes nobody picked reads as "we need none of those" to
 * whoever is buying the shirts rather than as "nobody has asked for one", and the two lead to
 * different boxes arriving. The server returns the zeroes for the same reason; this is the half
 * that has to show them.
 *
 * The fixture below is *a* survey rather than *the* survey: the questions are rows an officer
 * edits, so this page draws a panel per question and knows the name of none of them.
 */

const term: ApiTerm = {
  year: 2035,
  season: 'FALL',
  startsAt: '2035-08-24T04:00:00.000Z',
  endsAt: '2035-12-14T04:59:59.999Z',
  fromCalendar: true,
}

const context = (
  role: UserRole = 'OFFICER',
  over: Partial<DashboardContext['membership']> = {},
): DashboardContext => ({
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
    ...over,
  } as DashboardContext['membership'],
  reloadMembership: () => Promise.resolve(),
})

const options = (counts: Record<string, number>) =>
  Object.entries(counts).map(([label, count]) => ({
    id: `o-${label}`,
    label,
    archived: false,
    count,
  }))

const summary = (over: Partial<ApiSurveySummary> = {}): ApiSurveySummary => ({
  responded: 4,
  outstanding: 2,
  questions: [
    {
      id: 'q-shirt',
      prompt: 'Shirt size',
      kind: 'SINGLE_CHOICE',
      answered: 4,
      none: null,
      options: options({ XS: 0, S: 0, M: 1, L: 3, XL: 0, '2XL': 0, '3XL': 0 }),
    },
    {
      id: 'q-allergies',
      prompt: 'Allergies',
      kind: 'MULTI_CHOICE',
      answered: 4,
      none: 2,
      options: options({ Nuts: 2, Soy: 0 }),
    },
    {
      id: 'q-notes',
      prompt: 'Anything else about food',
      kind: 'LONG_TEXT',
      answered: 1,
      none: null,
      options: [],
    },
  ],
  gradYears: [
    { value: 2027, count: 1 },
    { value: 2028, count: 3 },
  ],
  ...over,
})

const renderPage = (dashboard = context()) =>
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<Outlet context={dashboard} />}>
          <Route path="/" element={<OfficerSurveyPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

afterEach(() => {
  vi.unstubAllGlobals()
})

/** The panel a tally lives in, so a count can be read without ambiguity. */
const panel = (label: string) =>
  screen.getByText(label).closest('div') as HTMLElement

describe('OfficerSurveyPage', () => {
  it('draws a panel per question, headed by the question', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/survey': summary() }))

    renderPage()

    expect(await screen.findByText('What the club knows.')).toBeInTheDocument()
    expect(screen.getByText('SHIRT SIZE')).toBeInTheDocument()
    expect(within(panel('ALLERGIES')).getByText('Nuts')).toBeInTheDocument()
  })

  /**
   * A NONE is an answer with nothing in it, so there is no option row it could
   * be counted into. Without a line of its own it would be the one answer on
   * the survey that nothing tallied.
   */
  it('counts the Nones on their own line', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/survey': summary() }))

    renderPage()

    await screen.findByText('ALLERGIES')

    expect(within(panel('ALLERGIES')).getByText('None')).toBeInTheDocument()
  })

  /** A written answer has no bars to draw, and says where the words are. */
  it('points a written question at the spreadsheet instead of drawing bars', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/survey': summary() }))

    renderPage()

    await screen.findByText('ANYTHING ELSE ABOUT FOOD')

    expect(
      within(panel('ANYTHING ELSE ABOUT FOOD')).getByText(/in the CSV/),
    ).toBeInTheDocument()
  })

  /** The desk this one is the other half of. */
  it('offers the way through to the questions', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/survey': summary() }))

    renderPage()

    expect(
      await screen.findByRole('link', { name: 'EDIT THE QUESTIONS' }),
    ).toHaveAttribute('href', '/dashboard/officer/survey/questions')
  })

  /**
   * The one that matters for an order. Every option is listed even on nought,
   * because a missing row and a zero row mean opposite things to somebody
   * deciding how many smalls to buy.
   */
  it('lists sizes nobody picked, on nought', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/survey': summary() }))

    renderPage()

    await screen.findByText('SHIRT SIZE')
    const sizes = panel('SHIRT SIZE')

    for (const label of ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL']) {
      expect(within(sizes).getByText(label)).toBeInTheDocument()
    }
  })

  it('says how many still owe one', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/survey': summary() }))

    renderPage()

    expect(await screen.findByText(/2 still to go/)).toBeInTheDocument()
  })

  /**
   * A different origin, so the href has to be absolute. A root-relative one
   * asks Vite for it and gets `index.html` back at a cheerful 200 — the trap
   * `storedFiles.ts` documents, met here with a download instead of an image.
   */
  it('offers the CSV as an absolute link to the API', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/survey': summary() }))

    renderPage()

    const link = await screen.findByRole('link', { name: 'DOWNLOAD CSV' })

    expect(link.getAttribute('href')).toMatch(
      /^https?:\/\/.+\/api\/officer\/survey\/export\.csv$/,
    )
  })

  it('says so when the results cannot be loaded', async () => {
    vi.stubGlobal('fetch', stubFetchNetworkError())

    renderPage()

    expect(await screen.findByText(/couldn.t load that/i)).toBeInTheDocument()
  })

  // ------------------------------------------------------------- the gates

  /**
   * Dues before role, the order every desk here uses: a lapsed officer is still
   * an officer, and the sentence they need is about a payment rather than about
   * permission they have not lost.
   */
  it('shows the dues lock before the role refusal', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/survey': summary() }))

    renderPage(
      context('OFFICER', {
        status: 'ready',
        data: {
          status: 'EXPIRED',
          hasAccess: false,
          duesRequired: true,
          paidThrough: '2024-01-15T00:00:00.000Z',
          freeThrough: null,
          term,
          billable: term,
          freeActive: false,
          canActivate: false,
          surveyPending: false,
          surveyPromptDismissed: false,
        },
      }),
    )

    expect(await screen.findByText('/ MANAGE · SURVEY')).toBeInTheDocument()
    expect(screen.queryByText('What the club knows.')).not.toBeInTheDocument()
  })

  /**
   * It carries members' names, contact details and their allergies, so a
   * non-officer gets the refusal rather than the page — and the page never
   * fetches, which is what keeps a 403 out of their console.
   */
  it('refuses a plain member without asking the server', async () => {
    const stub = stubFetch({ '/officer/survey': summary() })
    vi.stubGlobal('fetch', stub)

    renderPage(context('MEMBER'))

    expect(
      screen.getByText('This desk belongs to the officers.'),
    ).toBeInTheDocument()
    expect(stub).not.toHaveBeenCalled()
  })

  it('lets an admin in', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/survey': summary() }))

    renderPage(context('ADMIN'))

    expect(await screen.findByText('What the club knows.')).toBeInTheDocument()
  })
})
