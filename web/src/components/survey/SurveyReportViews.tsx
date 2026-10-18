import { useId, useState } from 'react'
import type { ApiSurveyQuestionTally, ApiSurveySummary } from '../../lib/api/api'
import { FormPanel, labelClass } from '../shared/formChrome'
import { InfoTip } from '../shared/InfoTip'
import {
  reportDate,
  responseAnswer,
  tallyRows,
  type TallyRow,
  type TallySort,
} from '../../lib/surveyReport'
import { reportButton } from './SurveyReportFilters'

const heading = 'mb-2 font-mono text-[10px] font-medium tracking-[0.16em] text-faint'
const isText = (question: ApiSurveyQuestionTally) =>
  question.kind === 'SHORT_TEXT' || question.kind === 'LONG_TEXT'
const share = (count: number, total: number) =>
  total > 0 ? Math.round((count / total) * 1000) / 10 : 0

export function TallyCharts({
  data,
  sort,
  hideZero,
  percentages,
  onRead,
}: {
  data: ApiSurveySummary
  sort: TallySort
  hideZero: boolean
  percentages: boolean
  onRead: (questionId: string) => void
}) {
  return (
    // Columns rather than a grid: a question with nine options beside one with two left a
    // row-height hole under the short one. Each chart sits straight under the last in its
    // column, and the order still reads down the markup.
    <div className="columns-[20rem] gap-x-5 [&>*]:mb-5 [&>*]:break-inside-avoid">
      {data.questions.map((question) => (
        <FormPanel key={question.id}>
          <h2 className={`${heading} flex items-center gap-1`}>
            {question.prompt.toUpperCase()}
            {question.kind === 'MULTI_CHOICE' && (
              <InfoTip label={question.prompt}>
                Members can select several answers; percentages can add up to more than
                100%.
              </InfoTip>
            )}
          </h2>
          <p className="mb-4 text-[12px] text-dim">
            {question.answered} answered ·{' '}
            {Math.max(0, data.responded - question.answered)} not answered
          </p>
          {isText(question) ? (
            <Written question={question} onRead={onRead} />
          ) : (
            <>
              <ul className="space-y-3">
                {tallyRows(question, sort, hideZero).map((row) => (
                  <ChartRow
                    key={row.id}
                    row={row}
                    total={question.answered}
                    percentages={percentages}
                  />
                ))}
              </ul>
              {tallyRows(question, sort, hideZero).length === 0 && (
                <p className="text-[13px] text-faint">
                  No answers to show. Turn off “Hide zero counts” to see all choices.
                </p>
              )}
            </>
          )}
        </FormPanel>
      ))}
      <GraduationYears data={data} percentages={percentages} />
    </div>
  )
}

function ChartRow({
  row,
  total,
  percentages,
}: {
  row: TallyRow
  total: number
  percentages: boolean
}) {
  const percentage = share(row.count, total)
  return (
    <li>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="min-w-0 text-[13px] leading-[1.6] wrap-anywhere text-dim">
          {row.label}
          {row.archived && <span className="ml-1.5 text-faint">(removed)</span>}
        </span>
        <span
          className={`shrink-0 font-mono text-[12px] ${row.count === 0 ? 'text-faint' : 'text-base-content'}`}
        >
          {row.count}
          {percentages && <span className="text-faint"> · {percentage}%</span>}
        </span>
      </div>
      <div className="h-1.5 bg-base-300" aria-hidden="true">
        <div
          className="h-full bg-primary"
          style={{ width: `${Math.min(100, percentage)}%` }}
        />
      </div>
    </li>
  )
}

function Written({
  question,
  onRead,
}: {
  question: ApiSurveyQuestionTally
  onRead: (id: string) => void
}) {
  return (
    <>
      <p className="text-[13px] leading-[1.6] text-dim">
        {question.answered === 0
          ? 'Nobody has written anything yet.'
          : `${question.answered} ${question.answered === 1 ? 'person has' : 'people have'} written something. Read the responses here or in the CSV.`}
      </p>
      {question.answered > 0 && (
        <button
          type="button"
          className={`${reportButton} mt-4`}
          onClick={() => onRead(question.id)}
        >
          READ WRITTEN ANSWERS
        </button>
      )}
    </>
  )
}

export function TallyTable({
  data,
  sort,
  hideZero,
  percentages,
  onRead,
}: {
  data: ApiSurveySummary
  sort: TallySort
  hideZero: boolean
  percentages: boolean
  onRead: (id: string) => void
}) {
  return (
    <div className="space-y-5">
      <div className="overflow-x-auto border border-rule">
        <table className="table w-full text-sm">
          <caption className="sr-only">Survey answer counts</caption>
          <thead>
            <tr>
              <th>Question</th>
              <th>Answer</th>
              <th className="text-right">Count</th>
              {percentages && <th className="text-right">% answered</th>}
            </tr>
          </thead>
          {data.questions.map((question) => {
            const rows = tallyRows(question, sort, hideZero)
            return (
              <tbody key={question.id}>
                {isText(question) ? (
                  <tr>
                    <th scope="row">{question.prompt}</th>
                    <td colSpan={percentages ? 3 : 2}>
                      <Written question={question} onRead={onRead} />
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <th scope="row">{question.prompt}</th>
                    <td colSpan={percentages ? 3 : 2}>No answers to show.</td>
                  </tr>
                ) : (
                  rows.map((row, index) => (
                    <tr key={row.id}>
                      {index === 0 && (
                        <th
                          scope="rowgroup"
                          rowSpan={rows.length}
                          className="min-w-32 align-top"
                        >
                          {question.prompt}
                          <p className="mt-1 text-[11px] font-normal text-faint">
                            {question.answered} answered
                          </p>
                        </th>
                      )}
                      <td className="min-w-32 wrap-anywhere">
                        {row.label}
                        {row.archived && <span className="text-faint"> (removed)</span>}
                      </td>
                      <td className="text-right font-mono">{row.count}</td>
                      {percentages && (
                        <td className="text-right font-mono">
                          {share(row.count, question.answered)}%
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            )
          })}
        </table>
      </div>
      <div className="max-w-[32rem]">
        <GraduationYears data={data} percentages={percentages} />
      </div>
    </div>
  )
}

function GraduationYears({
  data,
  percentages,
}: {
  data: ApiSurveySummary
  percentages: boolean
}) {
  const unknown =
    data.responded - data.gradYears.reduce((total, row) => total + row.count, 0)
  return (
    <FormPanel>
      <h2 className={heading}>GRADUATION YEARS</h2>
      {data.responded === 0 ? (
        <p className="text-[13px] text-faint">Nothing yet.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {data.gradYears.map((row) => (
            <ChartRow
              key={row.value}
              row={{ id: String(row.value), label: String(row.value), count: row.count }}
              total={data.responded}
              percentages={percentages}
            />
          ))}
          {unknown > 0 && (
            <ChartRow
              row={{ id: 'unknown', label: 'Not provided', count: unknown }}
              total={data.responded}
              percentages={percentages}
            />
          )}
        </ul>
      )}
    </FormPanel>
  )
}

export function SurveyResponses({
  data,
  sort,
  onSort,
}: {
  data: ApiSurveySummary
  sort: string
  onSort: (sort: string) => void
}) {
  const id = useId()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const pages = Math.max(1, Math.ceil(data.responses.length / pageSize))
  const current = Math.min(page, pages)
  const rows = data.responses.slice((current - 1) * pageSize, current * pageSize)
  return (
    <section aria-label="Individual survey responses">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <label className={labelClass} htmlFor={`${id}-sort`}>
            SORT RESPONSES
          </label>
          <select
            id={`${id}-sort`}
            className="select border-rule bg-base-200 text-sm"
            value={sort}
            onChange={(event) => onSort(event.target.value)}
          >
            <option value="updated_desc">Last updated, newest first</option>
            <option value="updated_asc">Last updated, oldest first</option>
            <option value="submitted_desc">Submitted, newest first</option>
            <option value="submitted_asc">Submitted, oldest first</option>
            <option value="name_asc">Name, A–Z</option>
            <option value="name_desc">Name, Z–A</option>
            <option value="grad_asc">Graduation year, earliest first</option>
            <option value="grad_desc">Graduation year, latest first</option>
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor={`${id}-size`}>
            ROWS PER PAGE
          </label>
          <select
            id={`${id}-size`}
            className="select border-rule bg-base-200 text-sm"
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value))
              setPage(1)
            }}
          >
            {[25, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="overflow-x-auto border border-rule">
        <table className="table w-full text-sm">
          <caption className="sr-only">Individual survey responses</caption>
          <thead>
            <tr>
              <th>Member</th>
              <th>Graduation</th>
              <th>Submitted</th>
              <th>Last updated</th>
              <th>Answers</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <th scope="row" className="min-w-40 align-top font-normal">
                  <p className="font-medium">{row.user.fullName}</p>
                  <p className="text-[12px] wrap-anywhere text-faint">
                    {row.user.email ?? row.user.discordUsername ?? 'No contact on file'}
                  </p>
                  {!row.user.active && (
                    <p className="text-[11px] text-faint">Inactive account</p>
                  )}
                </th>
                <td className="align-top">{row.user.gradYear ?? 'Not provided'}</td>
                <td className="min-w-36 align-top text-[12px]">
                  <time dateTime={row.submittedAt}>{reportDate(row.submittedAt)}</time>
                </td>
                <td className="min-w-36 align-top text-[12px]">
                  <time dateTime={row.updatedAt}>{reportDate(row.updatedAt)}</time>
                </td>
                <td className="min-w-48 align-top">
                  <details className="max-w-[28rem]">
                    <summary
                      className="cursor-pointer text-[12px] font-semibold text-primary"
                      aria-label={`View answers for ${row.user.fullName}`}
                    >
                      View answers
                    </summary>
                    <dl className="mt-3 space-y-3">
                      {data.questions.map((question) => (
                        <div key={question.id}>
                          <dt className="text-[11px] text-faint">{question.prompt}</dt>
                          <dd className="mt-1 text-[13px] leading-[1.6] wrap-anywhere whitespace-pre-wrap">
                            {responseAnswer(
                              question,
                              row.answers.find(
                                (answer) => answer.questionId === question.id,
                              ),
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12px] text-faint">
          Showing {data.responded === 0 ? 0 : (current - 1) * pageSize + 1}–
          {Math.min(current * pageSize, data.responded)} of {data.responded} responses ·
          Dates in Orlando time
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className={reportButton}
            disabled={current <= 1}
            onClick={() => setPage(current - 1)}
          >
            PREVIOUS
          </button>
          <span className="text-[12px] text-faint">
            {current} / {pages}
          </span>
          <button
            type="button"
            className={reportButton}
            disabled={current >= pages}
            onClick={() => setPage(current + 1)}
          >
            NEXT
          </button>
        </div>
      </div>
    </section>
  )
}
