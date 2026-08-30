import { useCallback, useEffect, useId, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import {
  FormEyebrow,
  FormHeading,
  measureClass,
  submitClass,
} from '../../components/shared/formChrome'
import { SurveyFields } from '../../components/survey/SurveyFields'
import {
  ApiError,
  getJson,
  postJson,
  putJson,
  type ApiSurveyState,
} from '../../lib/api/api'
import { useSession } from '../../lib/auth/session'
import {
  answersFor,
  draftFrom,
  surveyProblem,
  type SurveyDraft,
  type SurveyEntry,
} from '../../lib/survey'

/**
 * The one-time member survey.
 *
 * **The one page in the dashboard that nothing locks**, and the mirror image of
 * what the dues page used to be: every other lock now points here, including
 * the dues page's own. So it follows `DuesPage`'s shape rather than the print
 * page's — its own session redirect, its own load, and all three remote states
 * rendered, because it has to work for somebody arriving cold with nothing else
 * on the screen to explain itself.
 *
 * **It stays reachable after it is answered.** Being *asked* once is the promise
 * the gate keeps; a shirt size nobody could correct afterwards would just mean
 * the club orders the wrong shirt. So the same form comes back pre-filled and
 * `PUT`s instead, and the heading says which of the two is happening.
 *
 * **What it asks is not written down anywhere in `web/`.** The questions are
 * rows officers edit at `/dashboard/officer/survey/questions`, so they arrive
 * with the answers and this page is the load, the validation, the two verbs and
 * the redirect. A question added after somebody answered turns up here the next
 * time they open it — the gate does not close again, which is the promise.
 */

type PageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: ApiSurveyState }

type Saving =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'failed'; message: string }
  | { status: 'saved' }

export function MemberSurveyPage() {
  const { session } = useSession()
  /**
   * Nullable for the reason the dues page's is: inside the app this always has
   * a parent, and its own tests render it alone. Unlocking the rail is a
   * courtesy — the server is what decides.
   */
  const dashboard = useOutletContext<DashboardContext | null>()
  const navigate = useNavigate()
  const id = useId()

  const [page, setPage] = useState<PageState>({ status: 'loading' })
  const [saving, setSaving] = useState<Saving>({ status: 'idle' })
  const [gradYear, setGradYear] = useState('')
  /**
   * The whole form is controlled, which is the one place this departs from the
   * print form's read-it-from-`FormData`-at-submit idiom. Answers change what
   * the fields around them render — an OTHER opens a text box, NONE clears a
   * set — so the state has to exist anyway, and a form half-controlled by state
   * and half by the DOM is the version that eventually disagrees with itself.
   *
   * Keyed by question id rather than by field name, because the questions are
   * rows an officer edits: there is no name to write down.
   */
  const [draft, setDraft] = useState<SurveyDraft>({})

  const edit = (questionId: string, entry: SurveyEntry) => {
    setDraft((current) => ({ ...current, [questionId]: entry }))
    setSaving({ status: 'idle' })
  }

  useEffect(() => {
    if (session.status === 'signed-out') {
      void navigate('/login', {
        replace: true,
        state: { from: '/dashboard/survey' },
      })
    }
  }, [session.status, navigate])

  const load = useCallback(async () => {
    try {
      const data = await getJson<ApiSurveyState>('/survey')

      setPage({ status: 'ready', data })
      setDraft(draftFrom(data.questions, data.survey))
      setGradYear(data.gradYear === null ? '' : String(data.gradYear))
    } catch (error) {
      console.error(error)
      setPage({
        status: 'error',
        message:
          error instanceof ApiError && error.status === 0
            ? "Couldn't reach the server. Check your connection and try again."
            : 'We could not load the survey just now. Please try again.',
      })
    }
  }, [])

  useEffect(() => {
    if (session.status === 'signed-in') void load()
  }, [session.status, load])

  if (session.status === 'loading' || page.status === 'loading') {
    return (
      <div aria-busy="true">
        <FormEyebrow>/ MEMBER SURVEY</FormEyebrow>
        <FormHeading>Loading the survey…</FormHeading>
        <div className="border-rule bg-base-200 h-72 border" />
      </div>
    )
  }

  if (page.status === 'error') {
    return (
      <>
        <FormEyebrow>/ MEMBER SURVEY</FormEyebrow>
        <FormHeading>We couldn&rsquo;t load that.</FormHeading>
        <p className={`${measureClass} text-dim text-sm leading-[1.7] text-pretty`}>
          {page.message}
        </p>
      </>
    )
  }

  if (session.status !== 'signed-in') return null

  const answered = page.data.survey !== null

  // Sync, like every other submit handler here: the async half is kicked off
  // rather than awaited, so the handler returns void and React gets what the
  // attribute's type asks for.
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    // Checked here rather than left to the server, because a 400 from
    // `zValidator` is a raw zod report and not something to put in front of
    // anybody — see the note on `ApiError.detail` in `lib/api/api.ts`.
    const problem = surveyProblem(page.data.questions, draft)

    if (problem !== null) {
      setSaving({ status: 'failed', message: problem })
      return
    }

    const year = Number(gradYear)

    if (!Number.isInteger(year) || year < 1960 || year > 2100) {
      setSaving({
        status: 'failed',
        message: 'That graduation year does not look right.',
      })
      return
    }

    setSaving({ status: 'saving' })

    void save({
      answers: answersFor(page.data.questions, draft),
      gradYear: year,
    })
  }

  const save = async (body: Record<string, unknown>) => {
    try {
      if (answered) {
        await putJson('/survey', body)
      } else {
        await postJson('/survey', body)
      }

      // Re-read rather than patching the response in: one source of truth for
      // this page's state, the same rule the dues page follows.
      await load()
      // Answering it unlocks the entire rail, which is holding an answer from
      // before the press. This is the call that makes it open without a reload.
      await dashboard?.reloadMembership()

      setSaving({ status: 'saved' })

      // Straight on to what they were locked out of. Only on the first answer:
      // somebody who came here deliberately to fix a shirt size has not asked
      // to be taken anywhere.
      if (!answered) void navigate('/dashboard')
    } catch (error) {
      console.error(error)
      setSaving({
        status: 'failed',
        message:
          error instanceof ApiError && error.status === 0
            ? "Couldn't reach the server. Try again in a moment."
            : error instanceof ApiError && error.status === 429
              ? "That's a few tries in a row — give it a few minutes."
              : error instanceof ApiError && error.detail
                ? error.detail
                : 'That did not save. Try again in a moment.',
      })
    }
  }

  const busy = saving.status === 'saving'

  return (
    <>
      <FormEyebrow>/ MEMBER SURVEY</FormEyebrow>
      <FormHeading>
        {answered ? 'Your answers.' : 'Two minutes, asked once.'}
      </FormHeading>

      <p className="text-dim mb-7 max-w-[46rem] text-sm leading-[1.7] text-pretty">
        {answered ? (
          <>
            You have already filled this in, so nothing here is asked again
            &mdash; but you can change any of it. Shirt sizes and graduation
            years move, and the club sometimes asks something new.
          </>
        ) : (
          <>
            This is how the club knows what size shirts to order and what it can
            safely feed people at meetings. Everything on the dashboard opens as
            soon as it is in.
          </>
        )}
      </p>

      {/* An officer removed every question, which is allowed and is not an
          error. Saying so beats a page with a heading, a paragraph and one
          gold button on it and nothing in between — and the button still
          works, because an empty survey is one somebody can still answer and
          get through the gate with. */}
      {page.data.questions.length === 0 && (
        <p className="text-faint mb-7 max-w-[46rem] text-sm leading-[1.7] text-pretty">
          There is nothing to fill in just now &mdash; the club has not put any
          questions on the survey. Press the button and carry on.
        </p>
      )}

      {/* The groups sit side by side wherever there is room for them. They are
          five unrelated questions rather than a form to be filled in order —
          nothing below depends on anything above — so a single column down a
          monitor was making a two-minute survey look like a long one.
          `items-start`, because the groups are different heights and a shirt
          size stretched to the height of the allergen list is mostly empty
          box. */}
      <form
        onSubmit={submit}
        className="grid-fluid items-start gap-5 [--col-min:21rem]"
      >
        <SurveyFields
          id={id}
          questions={page.data.questions}
          draft={draft}
          onEdit={edit}
          disabled={busy}
          gradYear={{
            value: gradYear,
            onChange: (value: string) => {
              setGradYear(value)
              setSaving({ status: 'idle' })
            },
          }}
        />

        {/* Across the foot of the grid, not in the next free cell: it submits
            all of it, and a button that had drifted into the third column
            beside a question would read as belonging to that question. Capped,
            because `submitClass` is `w-full` and a gold bar the width of a
            monitor is not a button. */}
        <div className="col-span-full max-w-[26rem]">
          <button type="submit" disabled={busy} className={submitClass}>
            {busy
              ? 'SAVING…'
              : answered
                ? 'SAVE MY ANSWERS'
                : 'SUBMIT AND CARRY ON'}
          </button>

          <p role="status" className="mt-3 min-h-5 text-[13px] leading-[1.5]">
            {saving.status === 'failed' && (
              <span className="text-error">{saving.message}</span>
            )}
            {saving.status === 'saved' && (
              <span className="text-success">Saved.</span>
            )}
          </p>
        </div>
      </form>
    </>
  )
}
