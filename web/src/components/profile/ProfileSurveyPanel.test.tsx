import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProfileSurveyPanel } from './ProfileSurveyPanel'
import type { ApiSurvey, ApiSurveyQuestion } from '../../lib/api/api'
import { urlOf } from '../../test/stubFetch'

/**
 * The survey, as the account page shows it back.
 *
 * It used to carry the whole form and does not any more: on a page of one- and
 * two-field panels it was several times the height of anything around it, and
 * the editor it held was `/dashboard/survey`'s editor anyway. So what this
 * suite has to hold down is the pair of properties that replaced it.
 *
 * **It prints every answer back.** The point of a summary is that somebody
 * checking whether their shirt size is right gets it without a press — a panel
 * that only offered a link would be a worse version of the rail row that
 * already went away.
 *
 * **It writes nothing.** No `PUT` leaves this panel, which is what makes the
 * old "must not send a stale graduation year" hazard impossible rather than
 * merely tested — ABOUT YOU two panels up owns that field.
 */

const option = (id: string, label: string, wantsText = false) => ({
  id,
  label,
  wantsText,
  retired: false,
})

const choice = (
  id: string,
  prompt: string,
  options: ApiSurveyQuestion['options'],
  over: Partial<ApiSurveyQuestion> = {},
): ApiSurveyQuestion => ({
  id,
  prompt,
  help: null,
  kind: 'SINGLE_CHOICE',
  required: true,
  allowNone: false,
  maxLength: 200,
  options,
  ...over,
})

/**
 * A survey, not *the* survey. What the club asks is rows an officer edits, so
 * the labels this panel prints are whatever the prompts say — which is the one
 * thing worth fixing in a fixture here.
 */
const QUESTIONS: ApiSurveyQuestion[] = [
  choice('q-major', 'Major', [
    option('o-ae', 'Aerospace Engineering'),
    option('o-other', 'Other', true),
  ]),
  choice('q-shirt', 'Shirt size', [option('o-m', 'M'), option('o-l', 'L')]),
  choice(
    'q-allergies',
    'Allergies',
    [option('o-nuts', 'Nuts'), option('o-shellfish', 'Shellfish')],
    { kind: 'MULTI_CHOICE', allowNone: true },
  ),
  choice('q-dietary', 'Dietary', [option('o-vegan', 'Vegan')], {
    kind: 'MULTI_CHOICE',
    allowNone: true,
  }),
  choice('q-source', 'Heard about us', [
    option('o-google', 'Google'),
    option('o-source-other', 'Other', true),
  ]),
]

const stored: ApiSurvey = {
  submittedAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  answers: [
    { questionId: 'q-major', optionIds: ['o-ae'], text: null },
    { questionId: 'q-shirt', optionIds: ['o-m'], text: null },
    {
      questionId: 'q-allergies',
      optionIds: ['o-nuts', 'o-shellfish'],
      text: null,
    },
    { questionId: 'q-dietary', optionIds: [], text: null },
    { questionId: 'q-source', optionIds: ['o-google'], text: null },
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
 * Reads only, and it refuses anything else out loud. A stub that quietly
 * answered a `PUT` would let an editor grow back on this panel without a test
 * noticing — the summary's whole contract is that it does not write.
 */
const stubApi = (survey: ApiSurvey | null, gradYear: number | null = 2026) =>
  vi.fn((input: string | URL | Request, init?: RequestInit) => {
    if (init?.method !== undefined && init.method !== 'GET') {
      return Promise.reject(
        new Error(`unexpected ${init.method} to ${urlOf(input)}`),
      )
    }

    return urlOf(input).includes('/survey')
      ? json({ questions: QUESTIONS, survey, gradYear })
      : Promise.reject(new Error(`no stub for ${urlOf(input)}`))
  })

const renderPanel = (gradYear: number | null = 2026) =>
  render(
    <MemoryRouter>
      <ProfileSurveyPanel gradYear={gradYear} />
    </MemoryRouter>,
  )

/** The value across from a label, which is the whole shape of this panel. */
const factFor = (label: string) =>
  screen.getByText(label).parentElement?.textContent ?? ''

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ProfileSurveyPanel', () => {
  it('prints the stored answers back in words', async () => {
    vi.stubGlobal('fetch', stubApi(stored))

    renderPanel()

    await screen.findByText('MAJOR')

    expect(factFor('MAJOR')).toContain('Aerospace Engineering')
    expect(factFor('SHIRT SIZE')).toContain('M')
    expect(factFor('ALLERGIES')).toContain('Nuts, Shellfish')
    expect(factFor('HEARD ABOUT US')).toContain('Google')
  })

  /**
   * A stored empty list could only have got there by somebody ticking NONE, so
   * it is an answer. A dash would read as a question they skipped, which is
   * the opposite of what the kitchen needs to know.
   */
  it('says None for a set somebody deliberately emptied', async () => {
    vi.stubGlobal('fetch', stubApi(stored))

    renderPanel()

    await screen.findByText('DIETARY')

    expect(factFor('DIETARY')).toContain('None')
  })

  /**
   * OTHER is a placeholder for an answer rather than an answer. Printing it at
   * somebody who typed a major is the site saying it did not keep what they
   * said.
   */
  it('prints a free-text major and source rather than the word Other', async () => {
    vi.stubGlobal(
      'fetch',
      stubApi({
        ...stored,
        answers: [
          {
            questionId: 'q-major',
            optionIds: ['o-other'],
            text: 'Biomedical Engineering',
          },
          {
            questionId: 'q-source',
            optionIds: ['o-source-other'],
            text: 'A poster in the library',
          },
        ],
      }),
    )

    renderPanel()

    await screen.findByText('MAJOR')

    expect(factFor('MAJOR')).toContain('Biomedical Engineering')
    expect(factFor('MAJOR')).not.toContain('Other')
    expect(factFor('HEARD ABOUT US')).toContain('A poster in the library')
  })

  /**
   * The panel is a summary, and the form it summarises is a page. This is the
   * link that gets somebody there, and the assertion that no second editor has
   * grown back on this page.
   */
  it('sends changes to the survey page rather than editing in place', async () => {
    const stub = stubApi(stored)
    vi.stubGlobal('fetch', stub)

    renderPanel()

    expect(
      await screen.findByRole('link', { name: 'CHANGE MY ANSWERS' }),
    ).toHaveAttribute('href', '/dashboard/survey')

    expect(screen.queryByLabelText('MAJOR')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'SAVE' })).not.toBeInTheDocument()
  })

  /**
   * The half that actually matters about the graduation year: this panel has
   * no write at all, so it cannot revert what ABOUT YOU typed.
   */
  it('neither shows a graduation year nor writes anything', async () => {
    const stub = stubApi(stored)
    vi.stubGlobal('fetch', stub)

    renderPanel()

    await screen.findByText('MAJOR')

    expect(screen.queryByText('GRADUATION YEAR')).not.toBeInTheDocument()

    const writes = stub.mock.calls.filter(
      ([, init]) => init?.method !== undefined && init.method !== 'GET',
    )

    expect(writes).toHaveLength(0)
  })

  // --------------------------------------------------------- the two states

  /**
   * The account page is one of the two the survey prompt deliberately stays
   * off, so somebody who still owes it lands here — and there is nothing to
   * print back until they have answered.
   */
  it('offers a link rather than a table before it has been answered', async () => {
    vi.stubGlobal('fetch', stubApi(null, null))

    renderPanel(null)

    expect(await screen.findByRole('link', { name: 'FILL IT IN' })).toHaveAttribute(
      'href',
      '/dashboard/survey',
    )
    expect(screen.queryByText('SHIRT SIZE')).not.toBeInTheDocument()
  })

  /**
   * The gap between the two pages. ABOUT YOU allows a null graduation year —
   * right for anybody who never answered the survey — so somebody who did can
   * clear it and end up holding a survey with a hole in it. `PUT /api/survey`
   * answers 409, and this is the only screen that would ever say so.
   */
  describe('with no graduation year on the account', () => {
    it('says so beside the answers', async () => {
      vi.stubGlobal('fetch', stubApi(stored, null))

      renderPanel(null)

      expect(
        await screen.findByText(/graduation year is missing/i),
      ).toBeInTheDocument()
    })

    /**
     * Read from the page, not from this panel's own fetch — which is what lets
     * filling the field in under ABOUT YOU clear this on the same press instead
     * of leaving it complaining until a reload.
     */
    it('is quiet again once the page says the year is back', async () => {
      vi.stubGlobal('fetch', stubApi(stored, null))

      const { rerender } = renderPanel(null)

      await screen.findByText(/graduation year is missing/i)

      rerender(
        <MemoryRouter>
          <ProfileSurveyPanel gradYear={2027} />
        </MemoryRouter>,
      )

      expect(
        screen.queryByText(/graduation year is missing/i),
      ).not.toBeInTheDocument()
    })
  })

  it('offers a retry when the answers cannot be loaded', async () => {
    const stub = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockImplementation(() => json({ questions: QUESTIONS, survey: stored, gradYear: 2026 }))

    vi.stubGlobal('fetch', stub)

    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))

    await waitFor(() => {
      expect(screen.getByText('SHIRT SIZE')).toBeInTheDocument()
    })
  })

  /**
   * Nothing at all while the read is in flight. The panels above it have
   * already landed, so a box appearing under a pointer already resting
   * somewhere is the whole column moving.
   */
  it('renders nothing until it knows', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    )

    const { container } = renderPanel()

    expect(container).toBeEmptyDOMElement()
  })
})
