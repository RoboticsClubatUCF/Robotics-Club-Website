import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OfficerSurveyQuestionsPage } from './OfficerSurveyQuestionsPage'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import type { ApiSurveyEditorQuestion, ApiTerm, UserRole } from '../../lib/api/api'
import { bodyOf, urlOf } from '../../test/stubFetch'

/**
 * The question editor. Three things are worth pinning and the rest is form plumbing.
 *
 * What REMOVE is going to do, said before it is pressed. A question nobody has answered is deleted;
 * one with answers is retired and its answers kept. The officer cannot tell which from the button,
 * so the confirmation has to.
 *
 * That editing an option sends its id. An option edited by id keeps the answers already given
 * against it; one that lost its id on the way through this page would be deleted and recreated,
 * silently resetting a tally to nought — which nobody notices until it is in a shirt order.
 *
 * That nothing here talks about locking anybody out, because that is the fear that would otherwise
 * stop an officer touching the page, and it is not true: the gate is stamped once and never moves.
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

const option = (id: string, label: string, picked = 0, wantsText = false) => ({
  id,
  label,
  wantsText,
  archived: false,
  picked,
})

/** Answered by nobody, so REMOVE deletes it. */
const FRESH: ApiSurveyEditorQuestion = {
  id: 'q-fresh',
  prompt: 'Which build night can you make',
  help: null,
  kind: 'SINGLE_CHOICE',
  required: true,
  allowNone: false,
  maxLength: null,
  position: 0,
  archived: false,
  answered: 0,
  options: [option('o-tue', 'Tuesday'), option('o-thu', 'Thursday')],
}

/** Answered by twelve people, so REMOVE retires it and keeps their answers. */
const ANSWERED: ApiSurveyEditorQuestion = {
  id: 'q-answered',
  prompt: 'Shirt size',
  help: 'Unisex sizing.',
  kind: 'SINGLE_CHOICE',
  required: true,
  allowNone: false,
  maxLength: null,
  position: 1,
  archived: false,
  answered: 12,
  options: [option('o-m', 'M', 5), option('o-l', 'L', 7)],
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

/**
 * One path, four verbs, so the stub branches on the method. Every write is
 * answered with an empty object: the page re-reads afterwards rather than
 * patching a response in, which is what makes "removing this retires it"
 * something the server decides rather than something this page guesses.
 */
const stubApi = (questions: ApiSurveyEditorQuestion[] = [FRESH, ANSWERED]) =>
  vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = urlOf(input)

    if (!url.includes('/officer/survey')) {
      return Promise.reject(new Error(`no stub for ${url}`))
    }

    if (init?.method !== undefined && init.method !== 'GET') return json({})

    return json({ questions })
  })

const renderPage = (dashboard = context()) =>
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<Outlet context={dashboard} />}>
          <Route path="/" element={<OfficerSurveyQuestionsPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

afterEach(() => {
  vi.unstubAllGlobals()
})

const writes = (stub: ReturnType<typeof stubApi>, method: string) =>
  stub.mock.calls.filter(([, init]) => init?.method === method)

/** The card a question sits in, so its own buttons can be reached. */
const cardFor = (prompt: string) =>
  screen.getByText(prompt).closest('div.border') as HTMLElement

describe('OfficerSurveyQuestionsPage', () => {
  it('lists the questions with what is known about each', async () => {
    vi.stubGlobal('fetch', stubApi())

    renderPage()

    expect(await screen.findByText('What the club asks.')).toBeInTheDocument()
    expect(screen.getByText('Shirt size')).toBeInTheDocument()
    expect(screen.getByText(/12 ANSWERED/)).toBeInTheDocument()
    expect(screen.getByText(/Tuesday · Thursday/)).toBeInTheDocument()
  })

  it('says so when there is nothing on the survey', async () => {
    vi.stubGlobal('fetch', stubApi([]))

    renderPage()

    await screen.findByText('What the club asks.')

    expect(screen.getByText(/nothing on the survey/i)).toBeInTheDocument()
  })

  // ------------------------------------------------------------------ adding

  it('sends a new question with its answers', async () => {
    const stub = stubApi()
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('What the club asks.')

    fireEvent.click(screen.getByRole('button', { name: 'ASK SOMETHING NEW' }))

    fireEvent.change(screen.getByLabelText('THE QUESTION'), {
      target: { value: 'What do you want to build' },
    })
    fireEvent.change(screen.getByLabelText('Answer 1'), {
      target: { value: 'A robot' },
    })
    fireEvent.change(screen.getByLabelText('Answer 2'), {
      target: { value: 'Other' },
    })

    fireEvent.submit(
      screen.getByRole('button', { name: 'SAVE' }).closest('form')!,
    )

    await waitFor(() => {
      expect(writes(stub, 'POST')).toHaveLength(1)
    })

    expect(bodyOf(writes(stub, 'POST')[0]![1])).toMatchObject({
      prompt: 'What do you want to build',
      kind: 'SINGLE_CHOICE',
      required: true,
      options: [
        { label: 'A robot', wantsText: false },
        { label: 'Other', wantsText: false },
      ],
    })
  })

  /** An empty row is somebody who pressed ADD AN ANSWER and changed their mind. */
  it('drops an answer left blank rather than sending it', async () => {
    const stub = stubApi()
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('What the club asks.')

    fireEvent.click(screen.getByRole('button', { name: 'ASK SOMETHING NEW' }))
    fireEvent.change(screen.getByLabelText('THE QUESTION'), {
      target: { value: 'Anything' },
    })
    fireEvent.change(screen.getByLabelText('Answer 1'), {
      target: { value: 'One' },
    })

    fireEvent.submit(
      screen.getByRole('button', { name: 'SAVE' }).closest('form')!,
    )

    await waitFor(() => {
      expect(writes(stub, 'POST')).toHaveLength(1)
    })

    expect(bodyOf(writes(stub, 'POST')[0]![1])).toMatchObject({
      options: [{ label: 'One' }],
    })
  })

  // ----------------------------------------------------------------- editing

  /**
   * The one that would go wrong silently. An option edited by id keeps the
   * answers given against it; one sent without an id is a new row, and the
   * tally starts again at nought.
   */
  it('sends an edited answer with the id it already had', async () => {
    const stub = stubApi()
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('What the club asks.')

    fireEvent.click(
      within(cardFor('Shirt size')).getByRole('button', { name: 'EDIT' }),
    )

    fireEvent.change(screen.getByLabelText('Answer 2'), {
      target: { value: 'Large' },
    })
    fireEvent.submit(
      screen.getByRole('button', { name: 'SAVE' }).closest('form')!,
    )

    await waitFor(() => {
      expect(writes(stub, 'PUT')).toHaveLength(1)
    })

    expect(bodyOf(writes(stub, 'PUT')[0]![1])).toMatchObject({
      options: [
        { id: 'o-m', label: 'M' },
        { id: 'o-l', label: 'Large' },
      ],
    })
  })

  /**
   * Forty ticks against a question that now wants a sentence are forty rows
   * nothing can render. The server refuses it; this is the page not offering it
   * in the first place.
   */
  it('will not let the kind change once anybody has answered', async () => {
    vi.stubGlobal('fetch', stubApi())

    renderPage()
    await screen.findByText('What the club asks.')

    fireEvent.click(
      within(cardFor('Shirt size')).getByRole('button', { name: 'EDIT' }),
    )

    expect(screen.getByLabelText('HOW IT IS ANSWERED')).toBeDisabled()
  })

  it('lets the kind change while nobody has', async () => {
    vi.stubGlobal('fetch', stubApi())

    renderPage()
    await screen.findByText('What the club asks.')

    fireEvent.click(
      within(cardFor('Which build night can you make')).getByRole('button', {
        name: 'EDIT',
      }),
    )

    expect(screen.getByLabelText('HOW IT IS ANSWERED')).toBeEnabled()
  })

  // ---------------------------------------------------------------- removing

  it('says the answers are kept when the question has some', async () => {
    const stub = stubApi()
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('What the club asks.')

    fireEvent.click(
      within(cardFor('Shirt size')).getByRole('button', { name: 'REMOVE' }),
    )

    expect(screen.getByText('Stop asking this?')).toBeInTheDocument()
    expect(screen.getByText(/Nothing is deleted/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'STOP ASKING IT' }))

    await waitFor(() => {
      expect(writes(stub, 'DELETE')).toHaveLength(1)
    })

    expect(urlOf(writes(stub, 'DELETE')[0]![0]!)).toContain('q-answered')
  })

  it('says it is a deletion when nobody has answered', async () => {
    vi.stubGlobal('fetch', stubApi())

    renderPage()
    await screen.findByText('What the club asks.')

    fireEvent.click(
      within(cardFor('Which build night can you make')).getByRole('button', {
        name: 'REMOVE',
      }),
    )

    expect(screen.getByText('Delete this question?')).toBeInTheDocument()
    expect(screen.getByText(/deleted outright/)).toBeInTheDocument()
  })

  it('offers a retired question back, with its answers still counted', async () => {
    const stub = stubApi([
      FRESH,
      { ...ANSWERED, archived: true },
    ])
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('What the club asks.')

    expect(screen.getByText('NO LONGER ASKED')).toBeInTheDocument()
    expect(screen.getByText(/12 ANSWERED/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'ASK IT AGAIN' }))

    await waitFor(() => {
      expect(writes(stub, 'POST')).toHaveLength(1)
    })

    expect(urlOf(writes(stub, 'POST')[0]![0]!)).toContain('q-answered/restore')
  })

  // -------------------------------------------------------------- reordering

  it.each(['retired', 'removed'] as const)(
    'offers to restore a %s answer instead of saving a new copy',
    async (state) => {
      const stub = stubApi([
        {
          ...ANSWERED,
          options: [
            ...ANSWERED.options,
            { ...option('o-other', 'Other', 2, true), archived: state === 'retired' },
          ],
        },
      ])
      vi.stubGlobal('fetch', stub)

      renderPage()
      await screen.findByText('What the club asks.')
      fireEvent.click(within(cardFor('Shirt size')).getByRole('button', { name: 'EDIT' }))
      if (state === 'removed') {
        fireEvent.click(screen.getByRole('button', { name: 'Remove answer 3' }))
      }
      fireEvent.click(screen.getByRole('button', { name: 'ADD AN ANSWER' }))
      fireEvent.change(screen.getByLabelText('Answer 3'), {
        target: { value: ' other ' },
      })

      expect(screen.getByLabelText('Answer 3')).toHaveAccessibleDescription(
        '“Other” was offered before. Restore it to keep its responses.',
      )
      expect(screen.getByRole('button', { name: 'SAVE' })).toBeDisabled()
      fireEvent.submit(screen.getByRole('button', { name: 'SAVE' }).closest('form')!)
      expect(writes(stub, 'PUT')).toHaveLength(0)

      fireEvent.click(screen.getByRole('button', { name: 'RESTORE EXISTING ANSWER' }))

      expect(screen.getByLabelText('Answer 3')).toHaveValue('Other')
      expect(screen.getAllByLabelText('asks them to say which')[2]).toBeChecked()
      expect(screen.getByRole('button', { name: 'SAVE' })).toBeEnabled()
      fireEvent.submit(screen.getByRole('button', { name: 'SAVE' }).closest('form')!)
      await waitFor(() => {
        expect(writes(stub, 'PUT')).toHaveLength(1)
      })
      expect(bodyOf(writes(stub, 'PUT')[0]![1])).toHaveProperty('options', [
        { id: 'o-m', label: 'M', wantsText: false },
        { id: 'o-l', label: 'L', wantsText: false },
        { id: 'o-other', label: 'Other', wantsText: true },
      ])
    },
  )

  it('replaces a matching typed row when using the retired answer list', async () => {
    const stub = stubApi([
      {
        ...ANSWERED,
        options: [...ANSWERED.options, { ...option('o-xl', 'XL', 3), archived: true }],
      },
    ])
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('What the club asks.')
    fireEvent.click(within(cardFor('Shirt size')).getByRole('button', { name: 'EDIT' }))
    fireEvent.click(screen.getByRole('button', { name: 'ADD AN ANSWER' }))
    fireEvent.change(screen.getByLabelText('Answer 3'), { target: { value: 'xl' } })
    fireEvent.click(screen.getByRole('button', { name: 'OFFER “XL” AGAIN' }))

    expect(screen.getByLabelText('Answer 3')).toHaveValue('XL')
    expect(screen.queryByLabelText('Answer 4')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'RESTORE EXISTING ANSWER' }),
    ).not.toBeInTheDocument()
    fireEvent.submit(screen.getByRole('button', { name: 'SAVE' }).closest('form')!)

    await waitFor(() => {
      expect(writes(stub, 'PUT')).toHaveLength(1)
    })
    expect(bodyOf(writes(stub, 'PUT')[0]![1])).toMatchObject({
      options: [{ id: 'o-m' }, { id: 'o-l' }, { id: 'o-xl' }],
    })
  })

  it('can restore an answer whose original row was cleared', async () => {
    const stub = stubApi()
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('What the club asks.')
    fireEvent.click(within(cardFor('Shirt size')).getByRole('button', { name: 'EDIT' }))
    fireEvent.change(screen.getByLabelText('Answer 2'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'ADD AN ANSWER' }))
    fireEvent.change(screen.getByLabelText('Answer 3'), { target: { value: ' l ' } })

    expect(screen.getByRole('button', { name: 'SAVE' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'RESTORE EXISTING ANSWER' }))
    expect(screen.getByLabelText('Answer 2')).toHaveValue('L')
    expect(screen.queryByLabelText('Answer 3')).not.toBeInTheDocument()
    fireEvent.submit(screen.getByRole('button', { name: 'SAVE' }).closest('form')!)

    await waitFor(() => {
      expect(writes(stub, 'PUT')).toHaveLength(1)
    })
    expect(bodyOf(writes(stub, 'PUT')[0]![1])).toHaveProperty('options', [
      { id: 'o-m', label: 'M', wantsText: false },
      { id: 'o-l', label: 'L', wantsText: false },
    ])
  })

  it('offers a restored answer again if it is removed before saving', async () => {
    vi.stubGlobal(
      'fetch',
      stubApi([
        {
          ...ANSWERED,
          options: [...ANSWERED.options, { ...option('o-xl', 'XL', 3), archived: true }],
        },
      ]),
    )

    renderPage()
    await screen.findByText('What the club asks.')
    fireEvent.click(within(cardFor('Shirt size')).getByRole('button', { name: 'EDIT' }))
    fireEvent.click(screen.getByRole('button', { name: 'OFFER “XL” AGAIN' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove answer 3' }))
    fireEvent.click(screen.getByRole('button', { name: 'OFFER “XL” AGAIN' }))

    expect(screen.getByLabelText('Answer 3')).toHaveValue('XL')
    expect(screen.queryByLabelText('Answer 4')).not.toBeInTheDocument()
  })

  it('checks renamed answers and clears the restore prompt when the label changes', async () => {
    vi.stubGlobal('fetch', stubApi())

    renderPage()
    await screen.findByText('What the club asks.')
    fireEvent.click(within(cardFor('Shirt size')).getByRole('button', { name: 'EDIT' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove answer 2' }))
    fireEvent.change(screen.getByLabelText('Answer 1'), { target: { value: ' l ' } })

    expect(
      screen.getByRole('button', { name: 'RESTORE EXISTING ANSWER' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'SAVE' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Answer 1'), { target: { value: 'M' } })
    expect(
      screen.queryByRole('button', { name: 'RESTORE EXISTING ANSWER' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'SAVE' })).toBeEnabled()
  })

  it('allows an unchanged answer when a duplicate retired copy already exists', async () => {
    vi.stubGlobal(
      'fetch',
      stubApi([
        {
          ...ANSWERED,
          options: [
            ...ANSWERED.options,
            { ...option('o-old-m', 'M', 3), archived: true },
          ],
        },
      ]),
    )

    renderPage()
    await screen.findByText('What the club asks.')
    fireEvent.click(within(cardFor('Shirt size')).getByRole('button', { name: 'EDIT' }))

    expect(
      screen.queryByRole('button', { name: 'RESTORE EXISTING ANSWER' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'SAVE' })).toBeEnabled()
  })

  it.each(['SINGLE_CHOICE', 'MULTI_CHOICE'] as const)(
    'reorders %s answers while keeping their ids, edits and written-reply setting',
    async (kind) => {
      const stub = stubApi([
        {
          ...ANSWERED,
          kind,
          options: [...ANSWERED.options, option('o-other', 'Other', 2, true)],
        },
      ])
      vi.stubGlobal('fetch', stub)

      renderPage()
      await screen.findByText('What the club asks.')
      fireEvent.click(within(cardFor('Shirt size')).getByRole('button', { name: 'EDIT' }))

      fireEvent.change(screen.getByLabelText('Answer 3'), {
        target: { value: 'Another size' },
      })
      const up = screen.getByRole('button', { name: 'Move answer 3 up' })
      up.focus()
      fireEvent.click(up)

      expect(up).toHaveFocus()
      expect(screen.getByLabelText('Answer 2')).toHaveValue('Another size')
      fireEvent.click(screen.getByRole('button', { name: 'Move answer 2 up' }))
      fireEvent.click(screen.getByRole('button', { name: 'Move answer 2 down' }))

      expect(screen.getByLabelText('Answer 1')).toHaveValue('Another size')
      expect(screen.getByLabelText('Answer 2')).toHaveValue('L')
      expect(screen.getByLabelText('Answer 3')).toHaveValue('M')
      expect(screen.getAllByLabelText('asks them to say which')[0]).toBeChecked()
      expect(writes(stub, 'PUT')).toHaveLength(0)
      expect(writes(stub, 'POST')).toHaveLength(0)

      fireEvent.submit(screen.getByRole('button', { name: 'SAVE' }).closest('form')!)

      expect(screen.getByRole('button', { name: 'Move answer 1 down' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Move answer 3 up' })).toBeDisabled()
      await waitFor(() => {
        expect(writes(stub, 'PUT')).toHaveLength(1)
      })
      expect(bodyOf(writes(stub, 'PUT')[0]![1])).toMatchObject({
        options: [
          { id: 'o-other', label: 'Another size', wantsText: true },
          { id: 'o-l', label: 'L', wantsText: false },
          { id: 'o-m', label: 'M', wantsText: false },
        ],
      })
    },
  )

  it('reorders newly added answers before creating the question', async () => {
    const stub = stubApi()
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('What the club asks.')
    fireEvent.click(screen.getByRole('button', { name: 'ASK SOMETHING NEW' }))
    fireEvent.change(screen.getByLabelText('THE QUESTION'), {
      target: { value: 'Build night' },
    })
    fireEvent.change(screen.getByLabelText('Answer 1'), { target: { value: 'Tuesday' } })
    fireEvent.change(screen.getByLabelText('Answer 2'), { target: { value: 'Thursday' } })
    fireEvent.click(screen.getByRole('button', { name: 'ADD AN ANSWER' }))
    fireEvent.change(screen.getByLabelText('Answer 3'), { target: { value: 'Friday' } })

    const up = screen.getByRole('button', { name: 'Move answer 3 up' })
    up.focus()
    fireEvent.click(up)
    expect(up).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Move answer 2 up' }))
    fireEvent.submit(screen.getByRole('button', { name: 'SAVE' }).closest('form')!)

    await waitFor(() => {
      expect(writes(stub, 'POST')).toHaveLength(1)
    })
    expect(bodyOf(writes(stub, 'POST')[0]![1])).toHaveProperty('options', [
      { label: 'Friday', wantsText: false },
      { label: 'Tuesday', wantsText: false },
      { label: 'Thursday', wantsText: false },
    ])
  })

  it('can move a restored answer and keeps its original id', async () => {
    const stub = stubApi([
      {
        ...ANSWERED,
        options: [...ANSWERED.options, { ...option('o-xl', 'XL', 3), archived: true }],
      },
    ])
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('What the club asks.')
    fireEvent.click(within(cardFor('Shirt size')).getByRole('button', { name: 'EDIT' }))
    expect(screen.queryByLabelText('Answer 3')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'OFFER “XL” AGAIN' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move answer 3 up' }))
    fireEvent.submit(screen.getByRole('button', { name: 'SAVE' }).closest('form')!)

    await waitFor(() => {
      expect(writes(stub, 'PUT')).toHaveLength(1)
    })
    expect(bodyOf(writes(stub, 'PUT')[0]![1])).toMatchObject({
      options: [{ id: 'o-m' }, { id: 'o-xl' }, { id: 'o-l' }],
    })
  })

  it('disables answer moves at the ends and discards moves on cancel', async () => {
    const stub = stubApi()
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('What the club asks.')
    fireEvent.click(within(cardFor('Shirt size')).getByRole('button', { name: 'EDIT' }))

    expect(screen.getByRole('button', { name: 'Move answer 1 up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move answer 2 down' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Move answer 2 up' }))
    expect(screen.getByLabelText('Answer 1')).toHaveValue('L')
    fireEvent.click(screen.getByRole('button', { name: 'CANCEL' }))
    fireEvent.click(within(cardFor('Shirt size')).getByRole('button', { name: 'EDIT' }))

    expect(screen.getByLabelText('Answer 1')).toHaveValue('M')
    expect(screen.getByLabelText('Answer 2')).toHaveValue('L')
    expect(writes(stub, 'PUT')).toHaveLength(0)
  })

  it('sends the whole order when a question is moved', async () => {
    const stub = stubApi()
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('What the club asks.')

    fireEvent.click(
      screen.getByRole('button', { name: 'Move “Shirt size” up' }),
    )

    await waitFor(() => {
      expect(writes(stub, 'POST')).toHaveLength(1)
    })

    // The whole live set, in the new order. A partial list would leave the
    // questions it omits colliding with the ones it names, and the server
    // refuses one.
    expect(bodyOf(writes(stub, 'POST')[0]![1])).toEqual({
      ids: ['q-answered', 'q-fresh'],
    })
  })

  it('cannot move the first question up or the last one down', async () => {
    vi.stubGlobal('fetch', stubApi())

    renderPage()
    await screen.findByText('What the club asks.')

    expect(
      screen.getByRole('button', { name: 'Move “Which build night can you make” up' }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Move “Shirt size” down' }),
    ).toBeDisabled()
  })

  // ------------------------------------------------------------- the gates

  it('prints the server sentence when a write is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        if (init?.method !== undefined && init.method !== 'GET') {
          return json({ error: 'Two of those answers are the same.' }, 400)
        }
        return urlOf(input).includes('/officer/survey')
          ? json({ questions: [FRESH] })
          : Promise.reject(new Error('no stub'))
      }),
    )

    renderPage()
    await screen.findByText('What the club asks.')

    fireEvent.click(
      screen.getByRole('button', { name: 'Move “Which build night can you make” up' }),
    )

    // The first question, so the move does nothing and never reaches the
    // server. Removing it is what does.
    fireEvent.click(
      within(cardFor('Which build night can you make')).getByRole('button', {
        name: 'REMOVE',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'DELETE IT' }))

    expect(
      await screen.findByText('Two of those answers are the same.'),
    ).toBeInTheDocument()
  })

  /**
   * Dues before role, the order every desk here uses: a lapsed officer is still
   * an officer, and the sentence they need is about a payment.
   */
  it('shows the dues lock before the role refusal', async () => {
    vi.stubGlobal('fetch', stubApi())

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

    expect(
      await screen.findByText('/ MANAGE · SURVEY · QUESTIONS'),
    ).toBeInTheDocument()
    expect(screen.queryByText('What the club asks.')).not.toBeInTheDocument()
  })

  it('refuses a plain member without asking the server', async () => {
    const stub = stubApi()
    vi.stubGlobal('fetch', stub)

    renderPage(context('MEMBER'))

    expect(
      screen.getByText('This desk belongs to the officers.'),
    ).toBeInTheDocument()
    expect(stub).not.toHaveBeenCalled()
  })
})
