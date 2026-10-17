import type { ApiSurveyAnswer, ApiSurveyQuestionTally } from './api/api'

export const DEFAULT_REPORT_FILTERS = {
  period: 'all',
  dateField: 'submitted',
  from: '',
  to: '',
  gradYear: '',
  population: 'all',
  q: '',
  questionId: '',
  answer: '',
  sort: 'updated_desc',
}
export type SurveyReportFilters = typeof DEFAULT_REPORT_FILTERS

export function readReportFilters(params: URLSearchParams): SurveyReportFilters {
  return Object.fromEntries(
    Object.entries(DEFAULT_REPORT_FILTERS).map(([key, value]) => [
      key,
      params.get(key) ?? value,
    ]),
  ) as SurveyReportFilters
}

export function reportParams(filters: SurveyReportFilters): URLSearchParams {
  const params = new URLSearchParams()
  for (const key of Object.keys(
    DEFAULT_REPORT_FILTERS,
  ) as (keyof SurveyReportFilters)[]) {
    if ((key === 'from' || key === 'to') && filters.period !== 'custom') continue
    if (key === 'answer' && !filters.questionId) continue
    const value = filters[key].trim()
    if (value && value !== DEFAULT_REPORT_FILTERS[key]) params.set(key, value)
  }
  return params
}

export const reportDate = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

export const reportDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

export function responseAnswer(
  question: ApiSurveyQuestionTally,
  answer: ApiSurveyAnswer | undefined,
) {
  if (!answer) return 'Not answered'
  const labels = question.options
    .filter((option) => answer.optionIds.includes(option.id))
    .map((option) => option.label)
  if (labels.length === 0)
    return question.none !== null ? 'None' : answer.text || 'Not answered'
  return answer.text ? `${labels.join(', ')} (${answer.text})` : labels.join(', ')
}

export type TallySort = 'survey' | 'count_desc' | 'count_asc' | 'label'
export type TallyRow = { id: string; label: string; count: number; archived?: boolean }
export function tallyRows(
  question: ApiSurveyQuestionTally,
  sort: TallySort,
  hideZero: boolean,
): TallyRow[] {
  const rows: TallyRow[] = [...question.options]
  if (question.none !== null)
    rows.push({ id: 'none', label: 'None', count: question.none })
  const visible = hideZero ? rows.filter((row) => row.count > 0) : rows
  return visible.sort((a, b) =>
    sort === 'count_desc'
      ? b.count - a.count
      : sort === 'count_asc'
        ? a.count - b.count
        : sort === 'label'
          ? a.label.localeCompare(b.label, 'en', { numeric: true, sensitivity: 'base' })
          : 0,
  )
}
