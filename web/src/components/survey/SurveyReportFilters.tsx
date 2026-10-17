import { useId } from 'react'
import type { ApiSurveySummary } from '../../lib/api/api'
import { fieldClass, labelClass } from '../shared/formChrome'
import type { SurveyReportFilters } from '../../lib/surveyReport'

const select = 'select w-full border-rule bg-base-200 text-sm'
export const reportButton =
  'btn btn-outline h-auto min-h-0 border-base-content/28 px-4 py-2.5 text-[12px] font-semibold text-base-content hover:border-base-content hover:bg-base-content/6 disabled:opacity-40'

export function SurveyReportFilters({
  value,
  onChange,
  onApply,
  onReset,
  facets,
  busy,
}: {
  value: SurveyReportFilters
  onChange: (value: SurveyReportFilters) => void
  onApply: () => void
  onReset: () => void
  facets: ApiSurveySummary['facets'] | undefined
  busy: boolean
}) {
  const id = useId()
  const set = (key: keyof SurveyReportFilters, next: string) =>
    onChange({ ...value, [key]: next })
  const question = facets?.questions.find((each) => each.id === value.questionId)
  const invalid =
    value.period === 'custom' &&
    ((!value.from && !value.to) || (value.from && value.to && value.from > value.to))
  return (
    <form
      className="mb-6 border border-rule bg-base-200 p-4 sm:p-5"
      aria-label="Filter survey responses"
      onSubmit={(event) => {
        event.preventDefault()
        if (!invalid) onApply()
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className={labelClass} htmlFor={`${id}-period`}>
            DATE RANGE
          </label>
          <select
            id={`${id}-period`}
            className={select}
            value={value.period}
            onChange={(event) => set('period', event.target.value)}
          >
            <option value="all">All time</option>
            <option value="current_term">Current semester</option>
            <option value="previous_term">Last semester</option>
            <option value="year">Current year</option>
            <option value="last30">Last 30 days</option>
            <option value="custom">Custom dates</option>
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor={`${id}-date`}>
            FILTER DATE BY
          </label>
          <select
            id={`${id}-date`}
            className={select}
            value={value.dateField}
            onChange={(event) => set('dateField', event.target.value)}
          >
            <option value="submitted">First submitted</option>
            <option value="updated">Last updated</option>
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor={`${id}-grad`}>
            GRADUATION YEAR
          </label>
          <select
            id={`${id}-grad`}
            className={select}
            value={value.gradYear}
            onChange={(event) => set('gradYear', event.target.value)}
          >
            <option value="">All years</option>
            <option value="unknown">Not provided</option>
            {facets?.gradYears.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor={`${id}-population`}>
            MEMBER ACCOUNTS
          </label>
          <select
            id={`${id}-population`}
            className={select}
            value={value.population}
            onChange={(event) => set('population', event.target.value)}
          >
            <option value="all">All accounts</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
        </div>
        {value.period === 'custom' && (
          <>
            <div>
              <label className={labelClass} htmlFor={`${id}-from`}>
                FROM
              </label>
              <input
                id={`${id}-from`}
                className={fieldClass}
                type="date"
                value={value.from}
                max={value.to || undefined}
                onChange={(event) => set('from', event.target.value)}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor={`${id}-to`}>
                THROUGH
              </label>
              <input
                id={`${id}-to`}
                className={fieldClass}
                type="date"
                value={value.to}
                min={value.from || undefined}
                onChange={(event) => set('to', event.target.value)}
              />
            </div>
          </>
        )}
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor={`${id}-search`}>
            SEARCH MEMBERS OR ANSWERS
          </label>
          <input
            id={`${id}-search`}
            className={fieldClass}
            type="search"
            maxLength={120}
            value={value.q}
            placeholder="Name, email, Discord, or an answer"
            onChange={(event) => set('q', event.target.value)}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor={`${id}-question`}>
            ANSWERED QUESTION
          </label>
          <select
            id={`${id}-question`}
            className={select}
            value={value.questionId}
            onChange={(event) =>
              onChange({
                ...value,
                questionId: event.target.value,
                answer: event.target.value ? 'answered' : '',
              })
            }
          >
            <option value="">Any question</option>
            {facets?.questions.map((each) => (
              <option key={each.id} value={each.id}>
                {each.prompt}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor={`${id}-answer`}>
            ANSWER
          </label>
          <select
            id={`${id}-answer`}
            className={select}
            disabled={!question}
            value={value.answer || 'answered'}
            onChange={(event) => set('answer', event.target.value)}
          >
            <option value="answered">Any submitted answer</option>
            <option value="unanswered">Not answered</option>
            {question?.allowNone && <option value="none">None</option>}
            {question?.options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
                {option.archived ? ' (removed)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className="btn h-auto min-h-0 px-5 py-2.5 text-[12px] btn-primary disabled:opacity-50"
          disabled={busy || Boolean(invalid)}
        >
          {busy ? 'LOADING…' : 'APPLY FILTERS'}
        </button>
        <button type="button" className={reportButton} onClick={onReset}>
          RESET FILTERS
        </button>
        <p className="text-[12px] leading-[1.6] text-faint">
          Dates use Orlando time. Semester presets use the configured semester dates.
        </p>
      </div>
      {invalid && (
        <p role="status" className="mt-3 text-[12px] text-error">
          Choose a start or end date, with the end on or after the start.
        </p>
      )}
    </form>
  )
}
