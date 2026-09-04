import { useCallback, useEffect, useId, useState } from 'react'
import { Link, useOutletContext } from 'react-router'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import { DuesLocked } from '../../components/dashboard/DuesLocked'
import { OfficerOnly } from '../../components/dashboard/OfficerOnly'
import { isOfficer } from '../../lib/auth/session'
import { ConfirmDialog } from '../../components/shared/ConfirmDialog'
import {
  FormEyebrow,
  FormHeading,
  FormPanel,
  fieldClass,
  labelClass,
  measureClass,
} from '../../components/shared/formChrome'
import { deleteJson, getJson, postJson, putJson } from '../../lib/api/api'
import type {
  ApiSurveyEditorOption,
  ApiSurveyEditorQuestion,
  SurveyQuestionKind,
} from '../../lib/api/api'
import { explainApiError } from '../../lib/api/apiErrors'
import { duesLocked } from '../../lib/dues/dues'

/**
 * `/dashboard/officer/survey/questions` — what the club asks its members.
 *
 * The survey used to be five columns in Postgres. Adding a question meant a migration, a route
 * change and a deploy, so the answer to "can we also ask which build night people can make" was
 * no, every August, for a year. The questions are rows now and this is where they're written.
 *
 * Nothing here can lock anybody out, and the page says so, because that's the fear that would
 * otherwise stop an officer touching it. `surveyCompletedAt` is stamped once and never moves.
 *
 * REMOVE isn't a delete once anybody has answered. The question is retired — off the form, off the
 * tallies, out of the CSV — and its answers are kept, because "stop asking this" and "throw away
 * what forty people told us" aren't the same instruction. The card says which of the two the press
 * will do before it's pressed.
 *
 * Its own route rather than a tab on the tallies desk: those are a page you read across, this is a
 * page you work down.
 */
export function OfficerSurveyQuestionsPage() {
  const { user, membership } = useOutletContext<DashboardContext>()

  // Dues before role, the order every other desk uses: a lapsed officer is
  // still an officer, and the sentence they need is about a payment.
  if (duesLocked(membership, user.role)) {
    return <DuesLocked eyebrow="/ MANAGE · SURVEY · QUESTIONS" />
  }

  if (!isOfficer(user.role)) {
    return <OfficerOnly eyebrow="/ MANAGE · SURVEY · QUESTIONS" why="What the club asks every member is board business." />
  }

  return <Editor />
}

// ------------------------------------------------------------------ chrome

const KINDS: { value: SurveyQuestionKind; label: string; note: string }[] = [
  { value: 'SINGLE_CHOICE', label: 'Pick one', note: 'One answer from a list.' },
  {
    value: 'MULTI_CHOICE',
    label: 'Tick any that apply',
    note: 'Any number from a list, or None.',
  },
  { value: 'SHORT_TEXT', label: 'A line', note: 'They type a short answer.' },
  {
    value: 'LONG_TEXT',
    label: 'A paragraph',
    note: 'They type as much as they want to.',
  },
]

const kindLabel = (kind: SurveyQuestionKind) =>
  KINDS.find((each) => each.value === kind)?.label ?? kind

const isChoice = (kind: SurveyQuestionKind) =>
  kind === 'SINGLE_CHOICE' || kind === 'MULTI_CHOICE'

const button =
  'btn btn-outline h-auto min-h-0 border-base-content/28 px-4 py-2 text-[11px] font-semibold tracking-[0.08em] text-base-content hover:border-base-content hover:bg-base-content/6 hover:text-base-content disabled:opacity-40'

const primary =
  'btn btn-primary h-auto min-h-0 px-5 py-2.5 text-[12px] font-semibold tracking-[0.04em] disabled:opacity-60'

const panelLabel =
  'text-faint font-mono text-[10px] font-medium tracking-[0.16em]'

const checkbox =
  'checkbox checkbox-sm border-rule checked:border-primary checked:bg-primary checked:text-primary-content shrink-0'

// ------------------------------------------------------------------- draft

type OptionDraft = { id?: string; label: string; wantsText: boolean }

type QuestionDraft = {
  prompt: string
  help: string
  kind: SurveyQuestionKind
  required: boolean
  allowNone: boolean
  /** A string, because it is bound to an input and empty means "no cap". */
  maxLength: string
  options: OptionDraft[]
}

const blank = (): QuestionDraft => ({
  prompt: '',
  help: '',
  kind: 'SINGLE_CHOICE',
  required: true,
  allowNone: false,
  maxLength: '',
  options: [
    { label: '', wantsText: false },
    { label: '', wantsText: false },
  ],
})

/**
 * A stored question as a draft.
 *
 * **The retired options are left out**, and that is the whole of how one comes
 * back: the save sends the list, and an option in the list is live. Leaving it
 * out is what keeps it retired, and BRING BACK below simply appends it.
 */
const draftFrom = (question: ApiSurveyEditorQuestion): QuestionDraft => ({
  prompt: question.prompt,
  help: question.help ?? '',
  kind: question.kind,
  required: question.required,
  allowNone: question.allowNone,
  maxLength: question.maxLength === null ? '' : String(question.maxLength),
  options: question.options
    .filter((option) => !option.archived)
    .map((option) => ({
      id: option.id,
      label: option.label,
      wantsText: option.wantsText,
    })),
})

const bodyFrom = (draft: QuestionDraft) => ({
  prompt: draft.prompt.trim(),
  help: draft.help.trim() || null,
  kind: draft.kind,
  required: draft.required,
  // Meaningless on anything but a tick-any question, and the server refuses it
  // there — so it is cleared on the way out rather than left to be argued with.
  allowNone: draft.kind === 'MULTI_CHOICE' && draft.allowNone,
  maxLength: draft.maxLength.trim() === '' ? null : Number(draft.maxLength),
  options: isChoice(draft.kind)
    ? draft.options
        .filter((option) => option.label.trim() !== '')
        .map((option) => ({
          ...(option.id === undefined ? {} : { id: option.id }),
          label: option.label.trim(),
          wantsText: option.wantsText,
        }))
    : [],
})

// ------------------------------------------------------------------ the page

type Page =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; questions: ApiSurveyEditorQuestion[] }

function Editor() {
  const [page, setPage] = useState<Page>({ status: 'loading' })
  /** The question being edited, `'new'` for the one being written. */
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [removing, setRemoving] = useState<ApiSurveyEditorQuestion | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await getJson<{ questions: ApiSurveyEditorQuestion[] }>(
        '/officer/survey/questions',
      )

      setPage({ status: 'ready', questions: data.questions })
    } catch (error) {
      console.error(error)
      setPage({ status: 'error', message: explainApiError(error) })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * Every write goes through here, and every one re-reads afterwards.
   *
   * One source of truth for the page, the same rule the dues page follows — and it matters more
   * here, because what a write did isn't always what it was asked to do: removing a question with
   * answers on it retires it, and half the fields on a card are counts only the server knows.
   */
  const run = async (act: () => Promise<unknown>) => {
    setBusy(true)
    setProblem(null)

    try {
      await act()
      await load()
      setOpen(null)
      setRemoving(null)
    } catch (error) {
      console.error(error)
      setProblem(explainApiError(error))
    } finally {
      setBusy(false)
    }
  }

  if (page.status === 'loading') {
    return (
      <div aria-busy="true">
        <FormEyebrow>/ MANAGE · SURVEY · QUESTIONS</FormEyebrow>
        <FormHeading>Reading the survey…</FormHeading>
        <div className="border-rule bg-base-200 h-64 border" />
      </div>
    )
  }

  if (page.status === 'error') {
    return (
      <>
        <FormEyebrow>/ MANAGE · SURVEY · QUESTIONS</FormEyebrow>
        <FormHeading>We couldn&rsquo;t load that.</FormHeading>
        <p className={`${measureClass} text-dim text-sm leading-[1.7] text-pretty`}>
          {page.message}
        </p>
      </>
    )
  }

  const live = page.questions.filter((question) => !question.archived)
  const retired = page.questions.filter((question) => question.archived)

  const move = (index: number, by: number) => {
    const ids = live.map((question) => question.id)
    const to = index + by

    if (to < 0 || to >= ids.length) return

    ;[ids[index], ids[to]] = [ids[to], ids[index]]

    void run(() => postJson('/officer/survey/reorder', { ids }))
  }

  return (
    <>
      <FormEyebrow>/ MANAGE · SURVEY · QUESTIONS</FormEyebrow>
      <FormHeading>What the club asks.</FormHeading>

      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <p className="text-dim max-w-[46rem] text-sm leading-[1.7] text-pretty">
          Every member answers this once before anything on the dashboard opens.
          <strong className="text-base-content">
            {' '}
            Adding a question locks nobody out
          </strong>{' '}
          &mdash; the people who have already answered stay through the gate, and
          are asked the new one next time they open the form.
        </p>

        <Link
          to="/dashboard/officer/survey"
          className={`${button} shrink-0 px-5 py-2.5 text-[12px]`}
        >
          BACK TO THE ANSWERS
        </Link>
      </div>

      {problem !== null && (
        <p role="alert" className="text-error mb-5 text-[13px] leading-[1.6]">
          {problem}
        </p>
      )}

      <div className={`${measureClass} flex flex-col gap-4`}>
        {live.length === 0 && open !== 'new' && (
          <FormPanel>
            <p className="text-dim text-sm leading-[1.7] text-pretty">
              There is nothing on the survey. Members are still asked to submit
              it &mdash; an empty one takes one press &mdash; so nobody is stuck,
              but the club learns nothing either.
            </p>
          </FormPanel>
        )}

        {live.map((question, index) => (
          <QuestionCard
            key={question.id}
            question={question}
            open={open === question.id}
            busy={busy}
            first={index === 0}
            last={index === live.length - 1}
            onOpen={() => {
              setProblem(null)
              setOpen(question.id)
            }}
            onClose={() => {
              setOpen(null)
            }}
            onMove={(by) => {
              move(index, by)
            }}
            onRemove={() => {
              setRemoving(question)
            }}
            onSave={(draft) => {
              void run(() =>
                putJson(`/officer/survey/questions/${question.id}`, bodyFrom(draft)),
              )
            }}
          />
        ))}

        {open === 'new' ? (
          <FormPanel>
            <p className={`${panelLabel} mb-4`}>A NEW QUESTION</p>
            <QuestionForm
              initial={blank()}
              busy={busy}
              retired={[]}
              onCancel={() => {
                setOpen(null)
              }}
              onSave={(draft) => {
                void run(() =>
                  postJson('/officer/survey/questions', bodyFrom(draft)),
                )
              }}
            />
          </FormPanel>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setProblem(null)
              setOpen('new')
            }}
            className={primary}
          >
            ASK SOMETHING NEW
          </button>
        )}

        {retired.length > 0 && (
          <div className="mt-6">
            <p className={`${panelLabel} mb-3`}>NO LONGER ASKED</p>
            <p className="text-faint mb-4 text-[13px] leading-[1.6] text-pretty">
              Off the form and out of the tallies. The answers people already
              gave are still here, and come back with the question.
            </p>

            <div className="flex flex-col gap-3">
              {retired.map((question) => (
                <FormPanel key={question.id}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-dim text-sm leading-[1.6]">
                        {question.prompt}
                      </p>
                      <p className="text-faint mt-1 font-mono text-[10px] tracking-[0.14em]">
                        {kindLabel(question.kind).toUpperCase()} ·{' '}
                        {question.answered} ANSWERED
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          postJson(
                            `/officer/survey/questions/${question.id}/restore`,
                            {},
                          ),
                        )
                      }
                      className={button}
                    >
                      ASK IT AGAIN
                    </button>
                  </div>
                </FormPanel>
              ))}
            </div>
          </div>
        )}
      </div>

      {removing !== null && (
        <ConfirmDialog
          title={
            removing.answered > 0 ? 'Stop asking this?' : 'Delete this question?'
          }
          confirmLabel={removing.answered > 0 ? 'STOP ASKING IT' : 'DELETE IT'}
          busy={busy}
          onDismiss={() => {
            setRemoving(null)
          }}
          onConfirm={() =>
            void run(() =>
              deleteJson(`/officer/survey/questions/${removing.id}`),
            )
          }
        >
          <p className="text-dim text-sm leading-[1.7] text-pretty">
            &ldquo;{removing.prompt}&rdquo; comes off the form straight away.
          </p>
          {/* The one number that changes what the button does, said before it
              is pressed rather than reported after. */}
          <p className="text-dim mt-3 text-sm leading-[1.7] text-pretty">
            {removing.answered > 0 ? (
              <>
                <span className="text-base-content">{removing.answered}</span>{' '}
                {removing.answered === 1 ? 'member has' : 'members have'}{' '}
                answered it, so their answers are kept and you can ask it again
                later. Nothing is deleted.
              </>
            ) : (
              <>Nobody has answered it, so it is deleted outright.</>
            )}
          </p>
        </ConfirmDialog>
      )}
    </>
  )
}

// ------------------------------------------------------------------ one card

function QuestionCard({
  question,
  open,
  busy,
  first,
  last,
  onOpen,
  onClose,
  onMove,
  onRemove,
  onSave,
}: {
  question: ApiSurveyEditorQuestion
  open: boolean
  busy: boolean
  first: boolean
  last: boolean
  onOpen: () => void
  onClose: () => void
  onMove: (by: number) => void
  onRemove: () => void
  onSave: (draft: QuestionDraft) => void
}) {
  if (open) {
    return (
      <FormPanel>
        <QuestionForm
          initial={draftFrom(question)}
          busy={busy}
          /** What leaving an option out of the list did, and the way back. */
          retired={question.options.filter((option) => option.archived)}
          /** Answers already given make the kind unchangeable — forty ticks
              against a question that now wants a sentence are forty rows
              nothing can render. */
          kindLocked={question.answered > 0}
          onCancel={onClose}
          onSave={onSave}
        />
      </FormPanel>
    )
  }

  return (
    <FormPanel>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm leading-[1.6] text-base-content">{question.prompt}</p>
          <p className={`${panelLabel} mt-1.5`}>
            {kindLabel(question.kind).toUpperCase()}
            {!question.required && ' · OPTIONAL'}
            {question.allowNone && ' · OFFERS NONE'}
            {' · '}
            {question.answered} ANSWERED
          </p>
          {isChoice(question.kind) && (
            <p className="text-faint mt-2 text-[13px] leading-[1.6] text-pretty">
              {question.options
                .filter((option) => !option.archived)
                .map((option) => option.label)
                .join(' · ')}
            </p>
          )}
        </div>

        <div className="flex shrink-0 gap-2">
          {/* Up and down rather than dragging. Two buttons work with a keyboard,
              survive jsdom, and are the whole of what reordering six questions
              needs. */}
          <button
            type="button"
            aria-label={`Move “${question.prompt}” up`}
            disabled={busy || first}
            onClick={() => {
              onMove(-1)
            }}
            className={button}
          >
            ↑
          </button>
          <button
            type="button"
            aria-label={`Move “${question.prompt}” down`}
            disabled={busy || last}
            onClick={() => {
              onMove(1)
            }}
            className={button}
          >
            ↓
          </button>
          <button type="button" disabled={busy} onClick={onOpen} className={button}>
            EDIT
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onRemove}
            className={`${button} hover:border-error hover:text-error`}
          >
            REMOVE
          </button>
        </div>
      </div>
    </FormPanel>
  )
}

// ------------------------------------------------------------------ the form

function QuestionForm({
  initial,
  busy,
  retired,
  kindLocked = false,
  onCancel,
  onSave,
}: {
  initial: QuestionDraft
  busy: boolean
  retired: ApiSurveyEditorOption[]
  kindLocked?: boolean
  onCancel: () => void
  onSave: (draft: QuestionDraft) => void
}) {
  const id = useId()
  const [draft, setDraft] = useState(initial)
  const [back, setBack] = useState<ApiSurveyEditorOption[]>(retired)

  const set = <K extends keyof QuestionDraft>(key: K, value: QuestionDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const setOption = (index: number, option: OptionDraft) => {
    setDraft((current) => ({
      ...current,
      options: current.options.map((each, at) => (at === index ? option : each)),
    }))
  }

  const choice = isChoice(draft.kind)

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSave(draft)
      }}
    >
      <div className="mb-5">
        <label htmlFor={`${id}-prompt`} className={labelClass}>
          THE QUESTION
        </label>
        <input
          id={`${id}-prompt`}
          type="text"
          maxLength={200}
          required
          value={draft.prompt}
          disabled={busy}
          onChange={(event) => {
            set('prompt', event.target.value)
          }}
          className={fieldClass}
        />
      </div>

      <div className="mb-5">
        <label htmlFor={`${id}-help`} className={labelClass}>
          THE SMALLER LINE UNDER IT
        </label>
        <input
          id={`${id}-help`}
          type="text"
          maxLength={500}
          value={draft.help}
          disabled={busy}
          onChange={(event) => {
            set('help', event.target.value)
          }}
          className={fieldClass}
        />
        {/* The reason a question gets answered honestly rather than skipped. */}
        <p className="text-faint mt-1.5 text-[12px] leading-[1.5] text-pretty">
          Where the <em>why</em> goes &mdash; &ldquo;we ask because the club buys
          food&rdquo;. Optional, and worth writing.
        </p>
      </div>

      <div className="mb-5">
        <label htmlFor={`${id}-kind`} className={labelClass}>
          HOW IT IS ANSWERED
        </label>
        <select
          id={`${id}-kind`}
          value={draft.kind}
          disabled={busy || kindLocked}
          onChange={(event) => {
            set('kind', event.target.value as SurveyQuestionKind)
          }}
          className="select border-rule bg-base-200 w-full text-sm disabled:opacity-60"
        >
          {KINDS.map((kind) => (
            <option key={kind.value} value={kind.value}>
              {kind.label} — {kind.note}
            </option>
          ))}
        </select>
        {kindLocked && (
          <p className="text-faint mt-1.5 text-[12px] leading-[1.5] text-pretty">
            People have already answered this one, so this cannot change. Remove
            it and ask a new question instead.
          </p>
        )}
      </div>

      <div className="mb-5 flex flex-col gap-3">
        <label className="text-dim flex cursor-pointer items-center gap-3 text-sm leading-[1.6]">
          <input
            type="checkbox"
            checked={draft.required}
            disabled={busy}
            onChange={(event) => {
              set('required', event.target.checked)
            }}
            className={checkbox}
          />
          They have to answer it
        </label>

        {draft.kind === 'MULTI_CHOICE' && (
          <label className="text-dim flex cursor-pointer items-center gap-3 text-sm leading-[1.6]">
            <input
              type="checkbox"
              checked={draft.allowNone}
              disabled={busy}
              onChange={(event) => {
                set('allowNone', event.target.checked)
              }}
              className={checkbox}
            />
            Offer a None box
          </label>
        )}

        {draft.kind === 'MULTI_CHOICE' && (
          /* The distinction the allergy question is built on, and the reason
             this box exists at all. */
          <p className="text-faint text-[12px] leading-[1.5] text-pretty">
            Without it, somebody who ticks nothing is indistinguishable from
            somebody who scrolled past. With it, &ldquo;none of these&rdquo; is
            an answer they pressed.
          </p>
        )}
      </div>

      {choice ? (
        <div className="mb-5">
          <p className={labelClass}>THE ANSWERS</p>

          <div className="flex flex-col gap-2.5">
            {draft.options.map((option, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2.5">
                <input
                  type="text"
                  aria-label={`Answer ${index + 1}`}
                  maxLength={120}
                  value={option.label}
                  disabled={busy}
                  onChange={(event) => {
                    setOption(index, { ...option, label: event.target.value })
                  }}
                  className={`${fieldClass} min-w-40 flex-1`}
                />

                <label className="text-faint flex cursor-pointer items-center gap-2 text-[12px] leading-[1.5]">
                  <input
                    type="checkbox"
                    checked={option.wantsText}
                    disabled={busy}
                    onChange={(event) => {
                      setOption(index, {
                        ...option,
                        wantsText: event.target.checked,
                      })
                    }}
                    className={checkbox}
                  />
                  asks them to say which
                </label>

                <button
                  type="button"
                  aria-label={`Remove answer ${index + 1}`}
                  disabled={busy}
                  onClick={() => {
                    set(
                      'options',
                      draft.options.filter((_, at) => at !== index),
                    )
                  }}
                  className={button}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={() => {
              set('options', [...draft.options, { label: '', wantsText: false }])
            }}
            className={`${button} mt-3`}
          >
            ADD AN ANSWER
          </button>

          <p className="text-faint mt-2.5 text-[12px] leading-[1.5] text-pretty">
            Only one answer can ask them to say which &mdash; there is one box
            for it, not one per answer. Removing an answer people have picked
            retires it rather than deleting it.
          </p>

          {back.length > 0 && (
            <div className="border-rule mt-4 border-t pt-3">
              <p className="text-faint mb-2 text-[12px] leading-[1.5]">
                Retired answers, kept for the people holding them:
              </p>
              <div className="flex flex-wrap gap-2">
                {back.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      set('options', [
                        ...draft.options,
                        {
                          id: option.id,
                          label: option.label,
                          wantsText: option.wantsText,
                        },
                      ])
                      setBack((current) =>
                        current.filter((each) => each.id !== option.id),
                      )
                    }}
                    className={button}
                  >
                    OFFER “{option.label}” AGAIN
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="mb-5">
          <label htmlFor={`${id}-max`} className={labelClass}>
            HOW LONG AN ANSWER MAY BE
          </label>
          <input
            id={`${id}-max`}
            type="number"
            inputMode="numeric"
            min={1}
            max={5000}
            value={draft.maxLength}
            disabled={busy}
            onChange={(event) => {
              set('maxLength', event.target.value)
            }}
            className={fieldClass}
          />
          <p className="text-faint mt-1.5 text-[12px] leading-[1.5]">
            Characters. Leave it blank and the site picks a sensible cap.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={busy} className={primary}>
          {busy ? 'SAVING…' : 'SAVE'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className={button}
        >
          CANCEL
        </button>
      </div>
    </form>
  )
}
