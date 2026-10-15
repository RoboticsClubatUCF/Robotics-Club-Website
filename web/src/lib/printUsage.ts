import type { ApiPrintUsage } from './api/api'
import { roundGrams } from './printing'

/**
 * The filament graph's arithmetic: finished prints into days, weeks, months or years, in the
 * officer's own timezone, which is why the server sends one row per print instead of totals.
 */

export type UsageScale = 'day' | 'week' | 'month' | 'year'

export interface UsageBucket {
  /** Local midnight on the day the period starts. */
  start: Date
  personal: number
  project: number
  total: number
  prints: number
  /** Finished prints with no grams recorded: counted here, not drawn. */
  unmeasured: number
}

const DAY = 86_400_000

/**
 * Columns for the range: days up to a month, weeks up to half a year (a semester is about
 * seventeen), months up to three years, then years.
 */
export function scaleFor(from: Date, to: Date): UsageScale {
  const days = (to.getTime() - from.getTime()) / DAY
  if (days <= 31) return 'day'
  if (days <= 26 * 7) return 'week'
  if (days <= 3 * 366) return 'month'
  return 'year'
}

/** The day, the Sunday that starts its week (as the site's calendars have it), the 1st, or 1 January. */
export function periodStart(date: Date, scale: UsageScale): Date {
  const [y, m, d] = [date.getFullYear(), date.getMonth(), date.getDate()]
  if (scale === 'year') return new Date(y, 0, 1)
  if (scale === 'month') return new Date(y, m, 1)
  return new Date(y, m, scale === 'week' ? d - date.getDay() : d)
}

// By calendar fields rather than milliseconds, so a week across a clock change is still a week.
function shift(start: Date, scale: UsageScale, by: number): Date {
  const [y, m, d] = [start.getFullYear(), start.getMonth(), start.getDate()]
  if (scale === 'year') return new Date(y + by, 0, 1)
  if (scale === 'month') return new Date(y, m + by, 1)
  return new Date(y, m, d + (scale === 'week' ? 7 : 1) * by)
}

/**
 * Every period from the one holding `from` to the one holding `to`, oldest first, empty ones
 * included. Only prints inside the range count, so a range starting on a Wednesday leaves out
 * that week's Monday.
 */
export function buckets(prints: ApiPrintUsage[], from: Date, to: Date): {
  scale: UsageScale
  periods: UsageBucket[]
} {
  const scale = scaleFor(from, to)
  const periods: UsageBucket[] = []
  for (let start = periodStart(from, scale); start <= to; start = shift(start, scale, 1)) {
    periods.push({ start, personal: 0, project: 0, total: 0, prints: 0, unmeasured: 0 })
  }
  const byStart = new Map(periods.map((period) => [period.start.getTime(), period]))

  for (const print of prints) {
    const at = new Date(print.settledAt)
    if (at < from || at > to) continue
    const period = byStart.get(periodStart(at, scale).getTime())
    if (!period) continue
    period.prints += 1
    if (print.grams === null) period.unmeasured += 1
    else if (print.projectId !== null) period.project += print.grams
    else period.personal += print.grams
  }

  return {
    scale,
    periods: periods.map((period) => ({
      ...period,
      personal: roundGrams(period.personal),
      project: roundGrams(period.project),
      total: roundGrams(period.personal + period.project),
    })),
  }
}

/** Whose prints the page shows: all, personal ones, project ones, or one project's. */
export type UsageShow = 'all' | 'personal' | 'projects' | `project:${string}`

/** Whether a print is in what SHOW and FILAMENT ask for; an empty filament means any. */
export function shown(print: ApiPrintUsage, show: UsageShow, filament: string): boolean {
  if (filament !== '' && print.filament !== filament) return false
  if (show === 'all') return true
  if (show === 'personal') return print.projectId === null
  if (show === 'projects') return print.projectId !== null
  return print.projectId === show.slice('project:'.length)
}

export type BreakdownBy = 'project' | 'filament'

export interface BreakdownRow {
  /** A project's id, `personal`, or a filament's name. */
  key: string
  name: string
  prints: number
  grams: number
}

/** The key personal prints share in the breakdown by project. Project ids are UUIDs. */
export const PERSONAL = 'personal'

/** The prints in the range added up by project, personal ones as one row, or by filament. */
export function breakdown(
  prints: ApiPrintUsage[],
  from: Date,
  to: Date,
  by: BreakdownBy,
  projects: Map<string, string>,
): BreakdownRow[] {
  const rows = new Map<string, BreakdownRow>()
  for (const print of prints) {
    const at = new Date(print.settledAt)
    if (at < from || at > to) continue
    const key = by === 'filament' ? print.filament : (print.projectId ?? PERSONAL)
    const name =
      by === 'filament'
        ? print.filament
        : print.projectId === null
          ? 'Personal prints'
          : (projects.get(print.projectId) ?? 'A project')
    const row = rows.get(key) ?? { key, name, prints: 0, grams: 0 }
    row.prints += 1
    row.grams += print.grams ?? 0
    rows.set(key, row)
  }
  return [...rows.values()].map((row) => ({ ...row, grams: roundGrams(row.grams) }))
}

/** The periods added up, for the line above the graph. */
export function totals(periods: UsageBucket[]) {
  const sum = (pick: (period: UsageBucket) => number) =>
    roundGrams(periods.reduce((total, period) => total + pick(period), 0))
  return {
    personal: sum((period) => period.personal),
    project: sum((period) => period.project),
    total: sum((period) => period.total),
    prints: periods.reduce((count, period) => count + period.prints, 0),
    unmeasured: periods.reduce((count, period) => count + period.unmeasured, 0),
  }
}

/** A day as a date field holds it: "2026-10-15", in local time. */
export const toDateInput = (date: Date): string =>
  [
    String(date.getFullYear()),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')

/** A date field's day as local midnight, or the last moment of it. Null when it isn't a date. */
export function fromDateInput(value: string, end = false): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const [, y, m, d] = match.map(Number) as [number, number, number, number]
  return end ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d)
}

/**
 * Round gridline values from 0 to at least `max`: steps of 1, 2, 2.5 or 5 times a power of ten,
 * about four of them.
 */
export function ticks(max: number): number[] {
  if (!(max > 0)) return [0, 1]
  const rough = max / 4
  const power = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? 10 * power
  const count = Math.ceil(max / step - 1e-9)
  return Array.from({ length: count + 1 }, (_, index) => roundGrams(index * step))
}

/** A gridline's label: "250 g", "1.5 kg". */
export const axisGrams = (value: number): string =>
  value >= 1000 ? `${String(roundGrams(value / 1000))} kg` : `${String(value)} g`

/** Under a column: "Oct 12" for a day or week, "Oct" for a month and the year for January. */
export function axisDate(start: Date, scale: UsageScale): string {
  if (scale === 'year' || (scale === 'month' && start.getMonth() === 0)) {
    return String(start.getFullYear())
  }
  return scale === 'month'
    ? start.toLocaleDateString(undefined, { month: 'short' })
    : start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** The period with its year, for the table: "Oct 11, 2026", "October 2026", "2026". */
export function periodDate(start: Date, scale: UsageScale): string {
  if (scale === 'year') return String(start.getFullYear())
  return scale === 'month'
    ? start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : start.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** The period in full, for the readout: "Week of Oct 11, 2026", and otherwise as above. */
export const periodName = (start: Date, scale: UsageScale): string =>
  scale === 'week' ? `Week of ${periodDate(start, scale)}` : periodDate(start, scale)
