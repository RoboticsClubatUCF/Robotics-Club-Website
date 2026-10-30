import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OfficerSurveyPage } from './OfficerSurveyPage'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import type { ApiSurveySummary, ApiTerm, UserRole } from '../../lib/api/api'
import { stubFetch, stubFetchNetworkError, urlOf } from '../../test/stubFetch'

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
      slicerTrained: true,
      printOperator: false,
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
  totalResponded: 4,
  outstanding: 2,
  range: {
    label: 'All time',
    from: null,
    to: null,
    estimated: false,
    dateField: 'submitted',
  },
  facets: {
    gradYears: [2027, 2028],
    questions: [
      {
        id: 'q-shirt',
        prompt: 'Shirt size',
        kind: 'SINGLE_CHOICE',
        allowNone: false,
        options: options({ M: 1, L: 3 }),
      },
      {
        id: 'q-allergies',
        prompt: 'Allergies',
        kind: 'MULTI_CHOICE',
        allowNone: true,
        options: options({ Nuts: 2, Soy: 0 }),
      },
      {
        id: 'q-notes',
        prompt: 'Anything else about food',
        kind: 'LONG_TEXT',
        allowNone: false,
        options: [],
      },
    ],
  },
  responses: Array.from({ length: 4 }, (_, index) => ({
    id: `response-${index}`,
    user: {
      fullName: `Member ${index + 1}`,
      email: `member${index + 1}@ucf.edu`,
      discordUsername: null,
      gradYear: index === 0 ? 2027 : 2028,
      active: true,
    },
    submittedAt: '2035-09-01T14:00:00.000Z',
    updatedAt: '2035-10-01T15:00:00.000Z',
    answers: [
      { questionId: 'q-shirt', optionIds: [index === 0 ? 'o-M' : 'o-L'], text: null },
      ...(index === 0
        ? [{ questionId: 'q-notes', optionIds: [], text: 'Please label ingredients.' }]
        : []),
    ],
  })),
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
      await screen.findByRole('link', { name: 'QUESTIONS' }),
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

    const label = await screen.findByText('ACTIVE MEMBERS WITHOUT A SURVEY')
    expect(within(label.parentElement!).getByText('2')).toBeInTheDocument()
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

  it('applies combined filters and carries them into the CSV download', async () => {
    const stub = stubFetch({ '/officer/survey': summary() })
    vi.stubGlobal('fetch', stub)
    renderPage()
    await screen.findByText('What the club knows.')
    fireEvent.change(screen.getByLabelText('DATE RANGE'), {
      target: { value: 'current_term' },
    })
    fireEvent.change(screen.getByLabelText('FILTER DATE BY'), {
      target: { value: 'updated' },
    })
    fireEvent.change(screen.getByLabelText('GRADUATION YEAR'), {
      target: { value: '2028' },
    })
    fireEvent.change(screen.getByLabelText('MEMBER ACCOUNTS'), {
      target: { value: 'active' },
    })
    fireEvent.change(screen.getByLabelText('SEARCH MEMBERS OR ANSWERS'), {
      target: { value: 'Member 1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'APPLY FILTERS' }))
    await waitFor(() => expect(stub.mock.calls).toHaveLength(2))
    const url = new URL(urlOf(stub.mock.calls[1]![0]))
    expect(Object.fromEntries(url.searchParams)).toEqual({
      period: 'current_term',
      dateField: 'updated',
      gradYear: '2028',
      population: 'active',
      q: 'Member 1',
    })
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'DOWNLOAD CSV' })).toHaveAttribute(
        'aria-disabled',
        'false',
      ),
    )
    const exportUrl = new URL(
      screen.getByRole('link', { name: 'DOWNLOAD CSV' }).getAttribute('href')!,
    )
    expect(exportUrl.search).toBe(url.search)
    fireEvent.click(screen.getByRole('button', { name: 'RESET FILTERS' }))
    await waitFor(() =>
      expect(
        screen.getByRole('link', { name: 'DOWNLOAD CSV' }).getAttribute('href'),
      ).not.toContain('?'),
    )
  })

  it('requires valid custom dates and supports filtering by a particular answer', async () => {
    const stub = stubFetch({ '/officer/survey': summary() })
    vi.stubGlobal('fetch', stub)
    renderPage()
    await screen.findByText('What the club knows.')
    fireEvent.change(screen.getByLabelText('DATE RANGE'), { target: { value: 'custom' } })
    expect(screen.getByRole('button', { name: 'APPLY FILTERS' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('FROM'), { target: { value: '2035-10-01' } })
    fireEvent.change(screen.getByLabelText('THROUGH'), {
      target: { value: '2035-10-31' },
    })
    fireEvent.change(screen.getByLabelText('ANSWERED QUESTION'), {
      target: { value: 'q-allergies' },
    })
    fireEvent.change(screen.getByLabelText('ANSWER'), { target: { value: 'none' } })
    fireEvent.click(screen.getByRole('button', { name: 'APPLY FILTERS' }))
    await waitFor(() => expect(stub.mock.calls).toHaveLength(2))
    const params = new URL(urlOf(stub.mock.calls[1]![0])).searchParams
    expect(Object.fromEntries(params)).toMatchObject({
      period: 'custom',
      from: '2035-10-01',
      to: '2035-10-31',
      questionId: 'q-allergies',
      answer: 'none',
    })
  })

  it('sorts answers by count and can hide zero counts or percentages', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/survey': summary() }))
    renderPage()
    await screen.findByText('SHIRT SIZE')
    fireEvent.change(screen.getByLabelText('SORT ANSWERS'), {
      target: { value: 'count_desc' },
    })
    const rows = within(panel('SHIRT SIZE')).getAllByRole('listitem')
    expect(within(rows[0]!).getByText('L')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('M')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Hide zero counts'))
    expect(within(panel('SHIRT SIZE')).getAllByRole('listitem')).toHaveLength(2)
    expect(within(panel('SHIRT SIZE')).queryByText('XS')).not.toBeInTheDocument()
    expect(within(panel('SHIRT SIZE')).getByText(/75%/)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Show percentages'))
    expect(within(panel('SHIRT SIZE')).queryByText(/75%/)).not.toBeInTheDocument()
  })

  it('shows a readable summary table and individual written responses', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/survey': summary() }))
    renderPage()
    await screen.findByText('SHIRT SIZE')
    fireEvent.click(screen.getByRole('button', { name: 'TABLE' }))
    expect(
      screen.getByRole('table', { name: 'Survey answer counts' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '% answered' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'RESPONSES' }))
    expect(
      screen.getByRole('table', { name: 'Individual survey responses' }),
    ).toBeInTheDocument()
    expect(screen.getByText('member1@ucf.edu')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('View answers for Member 1'))
    expect(screen.getByText('Please label ingredients.')).toBeVisible()
  })

  it('opens written answers using the matching question filter', async () => {
    const stub = stubFetch({ '/officer/survey': summary() })
    vi.stubGlobal('fetch', stub)
    renderPage()
    await screen.findByText('SHIRT SIZE')
    fireEvent.click(screen.getByRole('button', { name: 'READ WRITTEN ANSWERS' }))
    await waitFor(() => expect(stub.mock.calls).toHaveLength(2))
    expect(urlOf(stub.mock.calls[1]![0])).toContain('questionId=q-notes&answer=answered')
    expect(
      await screen.findByRole('table', { name: 'Individual survey responses' }),
    ).toBeInTheDocument()
  })

  it('paginates response lists and sorts them through the same filtered API', async () => {
    const base = summary()
    const stub = stubFetch({
      '/officer/survey': summary({
        responded: 26,
        totalResponded: 26,
        responses: Array.from({ length: 26 }, (_, index) => ({
          ...base.responses[0]!,
          id: `r-${index}`,
          user: { ...base.responses[0]!.user, fullName: `Member ${index + 1}` },
        })),
      }),
    })
    vi.stubGlobal('fetch', stub)
    renderPage()
    await screen.findByText('SHIRT SIZE')
    fireEvent.click(screen.getByRole('button', { name: 'RESPONSES' }))
    expect(screen.getByText('Member 25')).toBeInTheDocument()
    expect(screen.queryByText('Member 26')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'NEXT' }))
    expect(screen.getByText('Member 26')).toBeInTheDocument()
    expect(screen.queryByText('Member 25')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('SORT RESPONSES'), {
      target: { value: 'name_asc' },
    })
    await waitFor(() => expect(stub.mock.calls).toHaveLength(2))
    expect(urlOf(stub.mock.calls[1]![0])).toContain('sort=name_asc')
    expect(await screen.findByText('Member 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'PREVIOUS' })).toBeDisabled()
  })

  it('explains an empty filtered cohort without dropping the controls', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({ '/officer/survey': summary({ responded: 0, responses: [] }) }),
    )
    renderPage()
    expect(
      await screen.findByText(/No responses match these filters/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'RESET FILTERS' })).toBeInTheDocument()
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
          slicerTrained: true,
          printOperator: false,
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
