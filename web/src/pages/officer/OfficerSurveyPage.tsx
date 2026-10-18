import { useEffect, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router'
import { SubNav } from '../../components/dashboard/SubNav'
import { SURVEY_PAGES } from '../../lib/dashboard/subPages'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import { DuesLocked } from '../../components/dashboard/DuesLocked'
import { OfficerOnly } from '../../components/dashboard/OfficerOnly'
import { isOfficer } from '../../lib/auth/session'
import {
  FormEyebrow,
  FormHeading,
  FormPanel,
  labelClass,
} from '../../components/shared/formChrome'
import { FilterChips } from '../../components/shared/FilterChips'
import { apiBaseUrl, getJson } from '../../lib/api/api'
import type { ApiSurveySummary } from '../../lib/api/api'
import { explainApiError } from '../../lib/api/apiErrors'
import { duesLocked } from '../../lib/dues/dues'
import {
  DEFAULT_REPORT_FILTERS,
  readReportFilters,
  reportDay,
  reportParams,
  type TallySort,
} from '../../lib/surveyReport'
import {
  SurveyReportFilters,
  reportButton,
} from '../../components/survey/SurveyReportFilters'
import {
  SurveyResponses,
  TallyCharts,
  TallyTable,
} from '../../components/survey/SurveyReportViews'

export function OfficerSurveyPage() {
  const { user, membership } = useOutletContext<DashboardContext>()
  if (duesLocked(membership, user.role)) return <DuesLocked eyebrow="/ MANAGE · SURVEY" />
  if (!isOfficer(user.role)) {
    return (
      <OfficerOnly
        eyebrow="/ MANAGE · SURVEY"
        why="It carries members’ names, contact details and their allergies, so it is board business."
      />
    )
  }
  return <Results />
}

type ReportState = {
  data: ApiSurveySummary | null
  loading: boolean
  error: string | null
}

function Results() {
  const [params, setParams] = useSearchParams()
  const applied = readReportFilters(params)
  const query = reportParams(applied).toString()
  const suffix = query ? `?${query}` : ''
  const [draft, setDraft] = useState(() => readReportFilters(params))
  const [refresh, setRefresh] = useState(0)
  const [page, setPage] = useState<ReportState>({
    data: null,
    loading: true,
    error: null,
  })
  const [view, setView] = useState<'charts' | 'table' | 'responses'>('charts')
  const [sort, setSort] = useState<TallySort>('survey')
  const [hideZero, setHideZero] = useState(false)
  const [percentages, setPercentages] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    setDraft(readReportFilters(new URLSearchParams(query)))
    setPage((current) => ({ ...current, loading: true, error: null }))
    getJson<ApiSurveySummary>(
      `/officer/survey${query ? `?${query}` : ''}`,
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted) setPage({ data, loading: false, error: null })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setPage((current) => ({
            ...current,
            loading: false,
            error: explainApiError(error),
          }))
      })
    return () => controller.abort()
  }, [query, refresh])

  const data = page.data
  const ready = data !== null && !page.loading && page.error === null
  const reset = () => {
    setDraft({ ...DEFAULT_REPORT_FILTERS })
    setParams({})
    setRefresh((current) => current + 1)
  }
  const readQuestion = (questionId: string) => {
    setParams(reportParams({ ...applied, questionId, answer: 'answered' }))
    setView('responses')
  }

  return (
    <>
      <FormEyebrow>/ MANAGE · SURVEY</FormEyebrow>
      <FormHeading>
        {!data && page.loading
          ? 'Counting the answers…'
          : !data && page.error
            ? 'We couldn’t load that.'
            : 'What the club knows.'}
      </FormHeading>
      <SubNav label="Survey pages" pages={SURVEY_PAGES} />
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className={reportButton}
            disabled={page.loading}
            onClick={() => setRefresh((current) => current + 1)}
          >
            REFRESH RESULTS
          </button>
          <a
            href={`${apiBaseUrl}/api/officer/survey/export.csv${suffix}`}
            className={`${reportButton} ${ready ? '' : 'pointer-events-none opacity-40'}`}
            aria-disabled={!ready}
            tabIndex={ready ? undefined : -1}
          >
            DOWNLOAD CSV
          </a>
        </div>
      </div>
      <SurveyReportFilters
        value={draft}
        onChange={setDraft}
        onApply={() => setParams(reportParams(draft))}
        onReset={reset}
        facets={data?.facets}
        busy={page.loading}
      />
      {page.error && (
        <div role="alert" className="mb-5 border border-error/40 p-4 text-sm text-error">
          {page.error} Clear the filters or refresh the results to try again.
        </div>
      )}
      {page.loading && (
        <div role="status" className="mb-5 text-sm text-dim">
          Loading survey results…
        </div>
      )}
      {ready && (
        <>
          <dl aria-label="Survey totals" className="mb-5 grid gap-3 sm:grid-cols-3">
            {[
              ['Matching responses', data.responded],
              ['All survey responses', data.totalResponded],
              ['Active members without a survey', data.outstanding],
            ].map(([label, count]) => (
              <div key={label} className="border border-rule bg-base-200 p-4">
                <dt className="font-mono text-[10px] tracking-[0.12em] text-faint">
                  {String(label).toUpperCase()}
                </dt>
                <dd className="mt-2 text-3xl font-semibold tabular-nums">{count}</dd>
              </div>
            ))}
          </dl>
          <p role="status" className="mb-5 text-[12px] leading-[1.7] text-dim">
            {data.responded} matching {data.responded === 1 ? 'response' : 'responses'} ·{' '}
            {data.range.label} ·{' '}
            {data.range.dateField === 'updated' ? 'Last updated' : 'First submitted'}
            {(data.range.from || data.range.to) && (
              <>
                {' '}
                · {data.range.from
                  ? reportDay(data.range.from)
                  : 'Any start'} through{' '}
                {data.range.to ? reportDay(data.range.to) : 'Any end'}
              </>
            )}
            {data.range.estimated && (
              <span className="text-warning"> · Using estimated semester dates</span>
            )}
          </p>
          {data.responded === 0 && (
            <div className="mb-5 border border-rule p-5">
              <p className="text-sm text-dim">
                No responses match these filters. Try a wider date range or reset the
                filters.
              </p>
            </div>
          )}
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <FilterChips
              value={view}
              onChange={setView}
              options={[
                { value: 'charts', label: 'CHARTS' },
                { value: 'table', label: 'TABLE' },
                { value: 'responses', label: 'RESPONSES' },
              ]}
            />
            {view !== 'responses' && (
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label className={labelClass} htmlFor="survey-tally-sort">
                    SORT ANSWERS
                  </label>
                  <select
                    id="survey-tally-sort"
                    className="select border-rule bg-base-200 text-sm"
                    value={sort}
                    onChange={(event) => setSort(event.target.value as TallySort)}
                  >
                    <option value="survey">Survey order</option>
                    <option value="count_desc">Most chosen first</option>
                    <option value="count_asc">Least chosen first</option>
                    <option value="label">Answer, A–Z</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 text-[12px] text-dim">
                  <input
                    className="checkbox checkbox-sm"
                    type="checkbox"
                    checked={hideZero}
                    onChange={(event) => setHideZero(event.target.checked)}
                  />
                  Hide zero counts
                </label>
                <label className="flex items-center gap-2 text-[12px] text-dim">
                  <input
                    className="checkbox checkbox-sm"
                    type="checkbox"
                    checked={percentages}
                    onChange={(event) => setPercentages(event.target.checked)}
                  />
                  Show percentages
                </label>
              </div>
            )}
          </div>
          {data.questions.length === 0 && (
            <FormPanel>
              <p className="text-sm text-dim">
                There are no questions on the survey. Put some on it and the answers will
                show up here.
              </p>
            </FormPanel>
          )}
          {view === 'responses' ? (
            <SurveyResponses
              key={query}
              data={data}
              sort={applied.sort}
              onSort={(next) => setParams(reportParams({ ...applied, sort: next }))}
            />
          ) : view === 'table' ? (
            <TallyTable
              data={data}
              sort={sort}
              hideZero={hideZero}
              percentages={percentages}
              onRead={readQuestion}
            />
          ) : (
            <TallyCharts
              data={data}
              sort={sort}
              hideZero={hideZero}
              percentages={percentages}
              onRead={readQuestion}
            />
          )}
        </>
      )}
    </>
  )
}
