import type { ReactNode } from 'react'
import type { ApiSurveyOption, ApiSurveyQuestion } from '../../lib/api/api'
import {
  offersNone,
  pick,
  pickNone,
  wantsText,
  type SurveyDraft,
  type SurveyEntry,
} from '../../lib/survey'
import { FormPanel, fieldClass, labelClass } from '../shared/formChrome'

/**
 * Every question on the member survey, drawn from whatever the club is asking.
 *
 * It used to be five questions written out by hand, one block of markup each, which is why adding
 * a sixth meant editing this file, `lib/survey.ts`, two routes and `schema.prisma`. The questions
 * are rows now, so this renders a kind rather than a question, and there are four of those.
 *
 * Still its own component with one caller. `MemberSurveyPage` is the load, the validation, the two
 * verbs and the redirect; this is the questions. The split is why a kind can be added in one place.
 *
 * The rules the fields obey live in `lib/survey.ts`, because the server enforces them and this
 * only has to avoid offering what the route will refuse.
 */
export function SurveyFields({
  id,
  questions,
  draft,
  onEdit,
  disabled,
  gradYear,
}: {
  id: string
  questions: ApiSurveyQuestion[]
  draft: SurveyDraft
  onEdit: (questionId: string, entry: SurveyEntry) => void
  disabled: boolean
  /**
   * The graduation year, when the caller owns it.
   *
   * Not a question, and it never will be: it's `User.gradYear`, which the profile page edits and
   * the public roster prints. Optional here because `PUT /api/survey` takes the year as optional —
   * a request from the account page's SURVEY panel must be able to leave it alone.
   */
  gradYear?: { value: string; onChange: (value: string) => void }
}) {
  return (
    <>
      {gradYear && (
        <FormPanel>
          <label htmlFor={`${id}-grad-year`} className={labelClass}>
            EXPECTED GRADUATION YEAR
          </label>
          <input
            id={`${id}-grad-year`}
            type="number"
            inputMode="numeric"
            min={1960}
            max={2100}
            step={1}
            value={gradYear.value}
            disabled={disabled}
            onChange={(event) => {
              gradYear.onChange(event.target.value)
            }}
            className={fieldClass}
          />
          <p className="text-faint mt-1.5 text-[12px] leading-[1.5]">
            The same year that shows on your profile &mdash; changing it here
            changes it there.
          </p>
        </FormPanel>
      )}

      {questions.map((question) => (
        <Question
          key={question.id}
          id={`${id}-${question.id}`}
          question={question}
          entry={draft[question.id] ?? { optionIds: [], text: '', none: false }}
          disabled={disabled}
          onEdit={(entry) => {
            onEdit(question.id, entry)
          }}
        />
      ))}
    </>
  )
}

/** One bordered panel per question, and a cell of the page's grid. */
function Question({
  id,
  question,
  entry,
  disabled,
  onEdit,
}: {
  id: string
  question: ApiSurveyQuestion
  entry: SurveyEntry
  disabled: boolean
  onEdit: (entry: SurveyEntry) => void
}) {
  const label = question.prompt.toUpperCase()
  const asksText = wantsText(question, entry)

  return (
    <FormPanel>
      {question.kind === 'SHORT_TEXT' || question.kind === 'LONG_TEXT' ? (
        <Written
          id={id}
          question={question}
          label={label}
          entry={entry}
          disabled={disabled}
          onEdit={onEdit}
        />
      ) : (
        <fieldset aria-label={question.prompt}>
          <legend className={labelClass}>
            {label}
            {!question.required && <Optional />}
          </legend>

          {question.kind === 'SINGLE_CHOICE' ? (
            <PickOne
              id={id}
              question={question}
              entry={entry}
              disabled={disabled}
              onEdit={onEdit}
            />
          ) : (
            <TickAny
              id={id}
              question={question}
              entry={entry}
              disabled={disabled}
              onEdit={onEdit}
            />
          )}

          {question.help !== null && <Help>{question.help}</Help>}
        </fieldset>
      )}

      {/* The line an OTHER asks for. Under the whole question rather than beside
          the answer that opened it: one box per question is what the server
          stores, and a box that appeared inside a grid of ticks would move
          everything below it as somebody read down the list. */}
      {asksText && (
        <div className="mt-5">
          <label htmlFor={`${id}-other`} className={labelClass}>
            WHICH ONE
          </label>
          <input
            id={`${id}-other`}
            type="text"
            maxLength={question.maxLength}
            value={entry.text}
            disabled={disabled}
            onChange={(event) => {
              onEdit({ ...entry, text: event.target.value })
            }}
            className={fieldClass}
          />
        </div>
      )}
    </FormPanel>
  )
}

/**
 * A question somebody types the answer to.
 *
 * One input or one textarea, chosen by the kind rather than by the length of
 * the cap: an officer who picked "a paragraph" gets a box that looks like one,
 * even if they then capped it at forty characters.
 */
function Written({
  id,
  question,
  label,
  entry,
  disabled,
  onEdit,
}: {
  id: string
  question: ApiSurveyQuestion
  label: string
  entry: SurveyEntry
  disabled: boolean
  onEdit: (entry: SurveyEntry) => void
}) {
  const change = (value: string) => {
    onEdit({ ...entry, text: value })
  }

  return (
    <>
      <label htmlFor={id} className={labelClass}>
        {label}
        {!question.required && <Optional />}
      </label>

      {question.kind === 'LONG_TEXT' ? (
        <textarea
          id={id}
          rows={2}
          maxLength={question.maxLength}
          value={entry.text}
          disabled={disabled}
          onChange={(event) => {
            change(event.target.value)
          }}
          className="textarea border-rule bg-base-200 w-full text-sm"
        />
      ) : (
        <input
          id={id}
          type="text"
          maxLength={question.maxLength}
          value={entry.text}
          disabled={disabled}
          onChange={(event) => {
            change(event.target.value)
          }}
          className={fieldClass}
        />
      )}

      {question.help !== null && <Help>{question.help}</Help>}
    </>
  )
}

/**
 * Short labels make a row of chips; long ones make a column of cards.
 *
 * Two layouts for one kind, because a shirt size and a major are the same question shape and
 * nothing like the same width. Eight sizes drawn as full-width cards are eight boxes ninety per
 * cent empty; "Mechanical Engineering" drawn as a chip wraps to two lines and stops looking
 * pressable. Measured rather than configured, because it's a property of the words an officer
 * typed.
 */
const COMPACT = 6

function PickOne({
  id,
  question,
  entry,
  disabled,
  onEdit,
}: {
  id: string
  question: ApiSurveyQuestion
  entry: SurveyEntry
  disabled: boolean
  onEdit: (entry: SurveyEntry) => void
}) {
  const chosen = (option: ApiSurveyOption) => entry.optionIds.includes(option.id)

  const choose = (option: ApiSurveyOption) => {
    onEdit(pick(question, entry, option.id))
  }

  const compact =
    question.options.length > 2 &&
    question.options.every((option) => option.label.length <= COMPACT)

  if (compact) {
    return (
      <div className="flex flex-wrap gap-2.5">
        {question.options.map((option) => (
          <label
            key={option.id}
            className={`min-w-14 cursor-pointer border px-4 py-2.5 text-center font-mono text-[11px] font-medium tracking-[0.1em] transition-colors duration-200 ${
              chosen(option)
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-rule bg-base-200 text-dim hover:border-base-content/25'
            } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
          >
            <input
              type="radio"
              name={id}
              value={option.id}
              checked={chosen(option)}
              disabled={disabled}
              onChange={() => {
                choose(option)
              }}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    )
  }

  return (
    <div className="grid-fluid gap-3 [--col-min:15rem]">
      {question.options.map((option) => (
        <label
          key={option.id}
          className={`flex cursor-pointer items-center justify-between gap-3 border p-4 transition-colors duration-200 ${
            chosen(option)
              ? 'border-primary bg-primary/5'
              : 'border-rule bg-base-200 hover:border-base-content/25'
          } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
        >
          <span className="font-mono text-[10px] font-medium tracking-[0.16em]">
            {option.label.toUpperCase()}
            {option.retired && <Retired />}
          </span>
          <input
            type="radio"
            name={id}
            value={option.id}
            checked={chosen(option)}
            disabled={disabled}
            onChange={() => {
              choose(option)
            }}
            className="radio radio-sm border-rule checked:bg-primary checked:text-primary-content shrink-0"
          />
        </label>
      ))}
    </div>
  )
}

/**
 * A set of checkboxes, with NONE as the box that clears the rest where the
 * question offers one.
 *
 * The mutual exclusion itself lives in `lib/survey.ts` — this is only the
 * markup for it.
 */
function TickAny({
  id,
  question,
  entry,
  disabled,
  onEdit,
}: {
  id: string
  question: ApiSurveyQuestion
  entry: SurveyEntry
  disabled: boolean
  onEdit: (entry: SurveyEntry) => void
}) {
  const box =
    'checkbox checkbox-sm border-rule checked:border-primary checked:bg-primary checked:text-primary-content shrink-0'

  return (
    <div className="grid-fluid gap-2.5 [--col-min:13rem]">
      {question.options.map((option) => (
        <div key={option.id} className="flex items-center gap-3">
          <input
            id={`${id}-${option.id}`}
            type="checkbox"
            checked={entry.optionIds.includes(option.id)}
            disabled={disabled}
            onChange={() => {
              onEdit(pick(question, entry, option.id))
            }}
            className={box}
          />
          <label
            htmlFor={`${id}-${option.id}`}
            className="text-dim cursor-pointer text-sm leading-[1.6]"
          >
            {option.label}
            {option.retired && <Retired />}
          </label>
        </div>
      ))}

      {/* Last, and separated: it is not one of the list, it is the answer that
          empties the list. There is no NONE option — an empty set is "none" —
          and this box is what turns that from a question somebody scrolled past
          into one they answered. */}
      {offersNone(question) && (
        <div className="border-rule col-span-full flex items-center gap-3 border-t pt-2.5">
          <input
            id={`${id}-none`}
            type="checkbox"
            checked={entry.none}
            disabled={disabled}
            onChange={() => {
              onEdit(pickNone(entry))
            }}
            className={box}
          />
          <label
            htmlFor={`${id}-none`}
            className="text-dim cursor-pointer text-sm leading-[1.6]"
          >
            None
          </label>
        </div>
      )}
    </div>
  )
}

const Help = ({ children }: { children: ReactNode }) => (
  <p className="text-faint mt-2 text-[12px] leading-[1.5] text-pretty">
    {children}
  </p>
)

/**
 * Said on the optional ones rather than the required ones.
 *
 * Most of a survey is required, so marking those is marking almost everything —
 * and a page of asterisks tells nobody which question they are allowed to skip.
 */
const Optional = () => (
  <span className="text-faint/70 ml-2 font-normal normal-case">optional</span>
)

/**
 * An answer this member picked before the club stopped offering it.
 *
 * Nobody else is shown it. Saying so is the difference between a member
 * wondering why they can see an answer their friend cannot, and one who
 * understands they are holding the last of something.
 */
const Retired = () => (
  <span className="text-faint/70 ml-2 text-[10px] font-normal normal-case">
    no longer offered
  </span>
)
