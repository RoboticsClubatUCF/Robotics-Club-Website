import {
  fireEvent,
  render as renderBare,
  screen,
  waitFor,
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemberSurveyPage } from './MemberSurveyPage'
import { SessionProvider } from '../../lib/auth/auth'
import type {
  ApiSurvey,
  ApiSurveyAnswer,
  ApiSurveyQuestion,
  ApiUser,
} from '../../lib/api/api'
import { bodyOf, urlOf } from '../../test/stubFetch'

/**
 * The member survey page. Three things are worth pinning and the rest is ordinary form plumbing.
 *
 * The NONE boxes, because they carry a distinction the database can't: an empty set of ticks is
 * "none" once it's stored, so the form is the only place that can tell somebody who answered from
 * somebody who scrolled past — and the club reads that list before it buys food.
 *
 * That the questions come from the payload. They're rows an officer edits, so nothing in `web/`
 * knows what the survey asks; the fixtures below are *a* survey rather than *the* survey, and a
 * question added on the officer desk must not need a line here.
 *
 * The unlock, because answering is what opens the rail, and the rail is holding an answer from
 * before the press. Without `reloadMembership` the page still works and the dashboard behind it
 * stays locked until a reload, which reads as the submission not having gone through.
 */

const user: ApiUser = {
  id: 'u1',
  fullName: 'Rowan Test',
  email: 'rowan@ucf.edu',
  slug: null,
  role: 'MEMBER',
  discordUsername: null,
  photoUrl: null,
  photoFocalX: 50,
  photoFocalY: 50,
  photoZoom: 1,
}

const option = (id: string, label: string, wantsText = false) => ({
  id,
  label,
  wantsText,
  retired: false,
})

/** Long labels, so this one draws as cards. */
const MAJOR: ApiSurveyQuestion = {
  id: 'q-major',
  prompt: 'Major',
  help: null,
  kind: 'SINGLE_CHOICE',
  required: true,
  allowNone: false,
  maxLength: 100,
  options: [
    option('o-cs', 'Computer Science'),
    option('o-ae', 'Aerospace Engineering'),
    option('o-other', 'Other', true),
  ],
}

/** Short ones, so this draws as the compact row of chips. */
const SHIRT: ApiSurveyQuestion = {
  id: 'q-shirt',
  prompt: 'Shirt size',
  help: 'Unisex sizing, so it runs a little large.',
  kind: 'SINGLE_CHOICE',
  required: true,
  allowNone: false,
  maxLength: 200,
  options: [option('o-m', 'M'), option('o-l', 'L'), option('o-xl', 'XL')],
}

const ALLERGIES: ApiSurveyQuestion = {
  id: 'q-allergies',
  prompt: 'Allergies',
  help: 'We ask because the club buys food.',
  kind: 'MULTI_CHOICE',
  required: true,
  allowNone: true,
  maxLength: 200,
  options: [option('o-nuts', 'Nuts'), option('o-soy', 'Soy')],
}

const DIETARY: ApiSurveyQuestion = {
  id: 'q-dietary',
  prompt: 'Dietary restrictions',
  help: null,
  kind: 'MULTI_CHOICE',
  required: true,
  allowNone: true,
  maxLength: 200,
  options: [option('o-vegan', 'Vegan')],
}

const QUESTIONS = [MAJOR, SHIRT, ALLERGIES, DIETARY]

const stored: ApiSurvey = {
  submittedAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  answers: [
    { questionId: MAJOR.id, optionIds: ['o-ae'], text: null },
    { questionId: SHIRT.id, optionIds: ['o-m'], text: null },
    { questionId: ALLERGIES.id, optionIds: ['o-nuts'], text: null },
    { questionId: DIETARY.id, optionIds: [], text: null },
  ],
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

/**
 * `/survey` is both read and written, so the stub has to branch on the method
 * rather than on the path the way `stubFetch` does.
 */
const stubApi = (
  survey: ApiSurvey | null,
  gradYear: number | null = null,
  questions: ApiSurveyQuestion[] = QUESTIONS,
) =>
  vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = urlOf(input)

    if (url.includes('/auth/me')) return json({ user })

    if (url.includes('/survey')) {
      if (init?.method === 'POST' || init?.method === 'PUT') {
        return json({ survey: survey ?? stored, gradYear })
      }
      return json({ questions, survey, gradYear })
    }

    return Promise.reject(new Error(`no stub for ${url}`))
  })

const render = () =>
  renderBare(<MemberSurveyPage />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={['/dashboard/survey']}>
        <SessionProvider>{children}</SessionProvider>
      </MemoryRouter>
    ),
  })

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Fill in everything the form needs, leaving one thing to each test. */
const completeTheForm = () => {
  fireEvent.click(screen.getByRole('radio', { name: 'COMPUTER SCIENCE' }))
  fireEvent.change(screen.getByLabelText('EXPECTED GRADUATION YEAR'), {
    target: { value: '2028' },
  })
  fireEvent.click(screen.getByRole('radio', { name: 'L' }))
}

const writeCalls = (stub: ReturnType<typeof stubApi>) =>
  stub.mock.calls.filter(
    ([, init]) => init?.method === 'POST' || init?.method === 'PUT',
  )

/** The answers a write sent, by question, so a test can name one. */
const sentFor = (init: RequestInit | undefined, questionId: string) => {
  const body = bodyOf(init) as { answers: ApiSurveyAnswer[] }

  return body.answers.find((answer) => answer.questionId === questionId)
}

describe('MemberSurveyPage', () => {
  it('offers an empty form to somebody who has not answered', async () => {
    vi.stubGlobal('fetch', stubApi(null))

    render()

    expect(await screen.findByText('Two minutes, asked once.')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'SUBMIT AND CARRY ON' }),
    ).toBeInTheDocument()
  })

  /** Whatever the club is asking, drawn from the payload rather than from here. */
  it('draws the questions it was given', async () => {
    vi.stubGlobal('fetch', stubApi(null))

    render()
    await screen.findByText('Two minutes, asked once.')

    expect(screen.getByRole('group', { name: 'Major' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Allergies' })).toBeInTheDocument()
    expect(screen.getByLabelText('Nuts')).toBeInTheDocument()
    expect(
      screen.getByText('We ask because the club buys food.'),
    ).toBeInTheDocument()
  })

  /**
   * An officer took every question off. Allowed, and not an error — the survey
   * is still submittable, which is what keeps it from being a lockout.
   */
  it('says so when there is nothing to fill in', async () => {
    vi.stubGlobal('fetch', stubApi(null, null, []))

    render()
    await screen.findByText('Two minutes, asked once.')

    expect(screen.getByText(/not put any questions/i)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'SUBMIT AND CARRY ON' }),
    ).toBeEnabled()
  })

  it('says the API could not be reached rather than showing an empty form', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) =>
        urlOf(input).includes('/auth/me')
          ? json({ user })
          : Promise.reject(new TypeError('Failed to fetch')),
      ),
    )

    render()

    expect(await screen.findByText(/Couldn't reach the server/)).toBeInTheDocument()
  })

  // ------------------------------------------------------------- the rules

  /**
   * The whole reason `lib/survey.ts` exists. A 400 from the server would carry
   * a raw zod report, which is a debugging aid rather than something to show
   * anybody — so the page has to catch this itself and say it in a sentence.
   */
  it('will not send an untouched allergy question', async () => {
    const stub = stubApi(null)
    vi.stubGlobal('fetch', stub)

    render()
    await screen.findByText('Two minutes, asked once.')

    completeTheForm()
    fireEvent.click(screen.getByRole('button', { name: 'SUBMIT AND CARRY ON' }))

    // Read off the status region rather than by text: the word "Allergies" is
    // also the legend, so a text query matches two nodes and finds neither.
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/allerg/i)
    })

    expect(writeCalls(stub)).toHaveLength(0)
  })

  /** Ticking None is what turns an empty set into an answer. */
  it('sends an empty answer once None is ticked', async () => {
    const stub = stubApi(null)
    vi.stubGlobal('fetch', stub)

    render()
    await screen.findByText('Two minutes, asked once.')

    completeTheForm()
    fireEvent.click(screen.getAllByLabelText('None')[0]!)
    fireEvent.click(screen.getAllByLabelText('None')[1]!)
    fireEvent.click(screen.getByRole('button', { name: 'SUBMIT AND CARRY ON' }))

    await waitFor(() => {
      expect(writeCalls(stub)).toHaveLength(1)
    })

    const init = writeCalls(stub)[0]![1]

    // The entry exists and is empty, which is the only thing that says "none"
    // rather than "skipped".
    expect(sentFor(init, ALLERGIES.id)).toEqual({
      questionId: ALLERGIES.id,
      optionIds: [],
      text: null,
    })
    expect(bodyOf(init)).toMatchObject({ gradYear: 2028 })
  })

  /** And the two are mutually exclusive, in that direction as well as the other. */
  it('unticks None when a real allergy is picked', async () => {
    const stub = stubApi(null)
    vi.stubGlobal('fetch', stub)

    render()
    await screen.findByText('Two minutes, asked once.')

    completeTheForm()
    const none = screen.getAllByLabelText('None')
    fireEvent.click(none[0]!)
    fireEvent.click(none[1]!)
    fireEvent.click(screen.getByLabelText('Nuts'))

    expect(none[0]).not.toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: 'SUBMIT AND CARRY ON' }))

    await waitFor(() => {
      expect(writeCalls(stub)).toHaveLength(1)
    })

    expect(sentFor(writeCalls(stub)[0]![1], ALLERGIES.id)?.optionIds).toEqual([
      'o-nuts',
    ])
  })

  it('asks which one when an answer that wants a line is picked', async () => {
    vi.stubGlobal('fetch', stubApi(null))

    render()
    await screen.findByText('Two minutes, asked once.')

    expect(screen.queryByLabelText('WHICH ONE')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'OTHER' }))

    expect(screen.getByLabelText('WHICH ONE')).toBeInTheDocument()
  })

  // ---------------------------------------------------------- the unlock

  /**
   * The call that opens the rail. Without it the dashboard behind this page
   * stays locked until a reload, which reads as the submission having failed.
   */
  it('reloads the membership so the rail unlocks', async () => {
    const stub = stubApi(null)
    vi.stubGlobal('fetch', stub)

    render()
    await screen.findByText('Two minutes, asked once.')

    completeTheForm()
    fireEvent.click(screen.getAllByLabelText('None')[0]!)
    fireEvent.click(screen.getAllByLabelText('None')[1]!)
    fireEvent.click(screen.getByRole('button', { name: 'SUBMIT AND CARRY ON' }))

    // Rendered without a `DashboardLayout`, so the context is null and
    // `reloadMembership` cannot be spied on directly — what proves the page got
    // that far is the re-read it does immediately before, which is the same
    // `await load()` the dues page's submit does.
    await waitFor(() => {
      expect(
        stub.mock.calls.filter(
          ([input, init]) =>
            urlOf(input).includes('/survey') && init?.method === undefined,
        ).length,
      ).toBeGreaterThan(1)
    })
  })

  it('prints the server sentence when a write is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = urlOf(input)
        if (url.includes('/auth/me')) return json({ user })
        if (init?.method === 'POST') {
          return json({ error: 'You have already filled this in.' }, 409)
        }
        return json({ questions: QUESTIONS, survey: null, gradYear: null })
      }),
    )

    render()
    await screen.findByText('Two minutes, asked once.')

    completeTheForm()
    fireEvent.click(screen.getAllByLabelText('None')[0]!)
    fireEvent.click(screen.getAllByLabelText('None')[1]!)
    fireEvent.click(screen.getByRole('button', { name: 'SUBMIT AND CARRY ON' }))

    expect(
      await screen.findByText('You have already filled this in.'),
    ).toBeInTheDocument()
  })

  // ------------------------------------------------------------- editing

  /**
   * It stays reachable afterwards on purpose. Being *asked* once is what the
   * gate promises; a shirt size nobody could correct would just mean the club
   * orders the wrong shirt.
   */
  it('comes back pre-filled once it has been answered', async () => {
    vi.stubGlobal('fetch', stubApi(stored, 2026))

    render()

    expect(await screen.findByText('Your answers.')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'AEROSPACE ENGINEERING' })).toBeChecked()
    expect(screen.getByLabelText('EXPECTED GRADUATION YEAR')).toHaveValue(2026)
    expect(screen.getByLabelText('Nuts')).toBeChecked()
    // A stored empty answer could only have got there by somebody ticking None,
    // so the box comes back ticked rather than asking again.
    expect(screen.getAllByLabelText('None')[1]).toBeChecked()
  })

  /**
   * A question the club added after this member answered. It is on the form,
   * unanswered — and the gate did not close behind them to make them fill it in.
   */
  it('shows a question added since, without anything being locked', async () => {
    const added: ApiSurveyQuestion = {
      id: 'q-added',
      prompt: 'Which build night can you make',
      help: null,
      kind: 'SHORT_TEXT',
      required: true,
      allowNone: false,
      maxLength: 60,
      options: [],
    }

    vi.stubGlobal('fetch', stubApi(stored, 2026, [...QUESTIONS, added]))

    render()
    await screen.findByText('Your answers.')

    expect(screen.getByLabelText('WHICH BUILD NIGHT CAN YOU MAKE')).toHaveValue('')
  })

  it('sends an edit as a PUT rather than a second POST', async () => {
    const stub = stubApi(stored, 2026)
    vi.stubGlobal('fetch', stub)

    render()
    await screen.findByText('Your answers.')

    fireEvent.click(screen.getByRole('radio', { name: 'XL' }))
    fireEvent.click(screen.getByRole('button', { name: 'SAVE MY ANSWERS' }))

    await waitFor(() => {
      expect(writeCalls(stub)).toHaveLength(1)
    })

    expect(writeCalls(stub)[0]![1]?.method).toBe('PUT')
    expect(sentFor(writeCalls(stub)[0]![1], SHIRT.id)?.optionIds).toEqual(['o-xl'])
  })
})
