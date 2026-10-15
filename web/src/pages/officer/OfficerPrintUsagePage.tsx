import { useState } from 'react'
import { Link, useOutletContext } from 'react-router'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import { DuesLocked } from '../../components/dashboard/DuesLocked'
import { OfficerOnly } from '../../components/dashboard/OfficerOnly'
import { UsageChart } from '../../components/dashboard/UsageChart'
import { FilterChips } from '../../components/shared/FilterChips'
import { FormEyebrow, FormHeading, FormPanel, measureClass } from '../../components/shared/formChrome'
import { quietButton } from '../../components/slicer/slicerChrome'
import type { ApiPrintUsageDesk } from '../../lib/api/api'
import { useApi } from '../../lib/api/useApi'
import { isOfficer } from '../../lib/auth/session'
import { duesLocked, termLabel } from '../../lib/dues/dues'
import { longDate } from '../../lib/format/formats'
import { grams } from '../../lib/printing'
import { buckets, fromDateInput, periodDate, toDateInput, totals } from '../../lib/printUsage'
import type { UsageBucket, UsageScale } from '../../lib/printUsage'

/**
 * How much filament the club has gone through: grams on finished filament prints, by the day an
 * officer marked them done, personal and project together. Resin isn't counted.
 *
 * The presets fill in FROM and TO, and changing either makes the range custom. The columns are
 * days, weeks, months or years, whichever suits the range's length.
 */

const EYEBROW = '/ MANAGE · PRINT QUEUE · FILAMENT'

type Preset = 'this' | 'last' | 'all'

const PRESETS = [
  { value: 'this', label: 'THIS SEMESTER' },
  { value: 'last', label: 'LAST SEMESTER' },
  { value: 'all', label: 'ALL TIME' },
] as const

type Range = { kind: Preset } | { kind: 'custom'; from: string; to: string }

const dateField =
  'input border-rule bg-base-200 h-11 w-40 px-2 font-mono text-[12px] wide:h-8'

const caption = 'text-faint font-mono text-[10px] font-medium tracking-[0.14em]'

const printsLabel = (count: number) => (count === 1 ? '1 print' : `${String(count)} prints`)

export function OfficerPrintUsagePage() {
  const { user, membership } = useOutletContext<DashboardContext>()

  if (duesLocked(membership, user.role)) return <DuesLocked eyebrow={EYEBROW} />
  if (!isOfficer(user.role)) {
    return (
      <OfficerOnly eyebrow={EYEBROW} why="The print records are kept by the officers who run the printers." />
    )
  }
  return <Usage />
}

/**
 * The range as dates, and the words for it in "42 g in Fall 2026 so far". A custom range with a
 * missing or backwards date has no dates, only the sentence saying what to fix.
 */
function resolve(
  range: Range,
  desk: ApiPrintUsageDesk,
  now: Date,
): { from: Date; to: Date; phrase: string } | { problem: string } {
  if (range.kind === 'custom') {
    const from = fromDateInput(range.from)
    const to = fromDateInput(range.to, true)
    if (!from || !to) return { problem: 'Pick a date for FROM and for TO.' }
    if (from > to) return { problem: 'FROM is after TO. Pick an earlier start.' }
    return {
      from,
      // Days still to come would draw as nothing used.
      to: to > now ? now : to,
      phrase: `from ${longDate(from.toISOString())} to ${longDate(to.toISOString())}`,
    }
  }
  const { current, last } = desk.terms
  if (range.kind === 'this') {
    return { from: new Date(current.from), to: now, phrase: `in ${termLabel(current)} so far` }
  }
  if (range.kind === 'last') {
    return { from: new Date(last.from), to: new Date(last.to), phrase: `in ${termLabel(last)}` }
  }
  const first = desk.prints[0]?.settledAt
  return first
    ? { from: new Date(first), to: now, phrase: `since ${longDate(first)}` }
    : { from: now, to: now, phrase: 'yet' }
}

/** Its own component so the fetch only happens past the gates above. */
function Usage() {
  const usage = useApi<ApiPrintUsageDesk>('/officer/print-usage')
  const [range, setRange] = useState<Range>({ kind: 'this' })

  const now = new Date()
  const desk = usage.status === 'ready' ? usage.data : null
  const resolved = desk ? resolve(range, desk, now) : null
  const dates = resolved && 'from' in resolved ? resolved : null
  const fromValue = range.kind === 'custom' ? range.from : dates ? toDateInput(dates.from) : ''
  const toValue = range.kind === 'custom' ? range.to : dates ? toDateInput(dates.to) : ''

  const graph = desk && dates ? buckets(desk.prints, dates.from, dates.to) : null
  const sum = graph ? totals(graph.periods) : null

  return (
    <>
      <FormEyebrow>{EYEBROW}</FormEyebrow>
      <FormHeading>Filament usage.</FormHeading>

      <div className={`${measureClass} mb-6 flex flex-wrap items-center gap-3`}>
        <p className="text-dim w-full text-sm leading-[1.7] text-pretty">
          Grams on finished filament prints, by the day they were marked done. Resin isn't counted.
        </p>
        <Link to="/dashboard/officer/print" className={quietButton}>
          ‹ BACK TO THE QUEUE
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <FilterChips<Preset | 'custom'>
          options={PRESETS}
          value={range.kind}
          disabled={!desk}
          onChange={(kind) => {
            if (kind !== 'custom') setRange({ kind })
          }}
        />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-2">
            <span className={`${caption} min-w-9 wide:min-w-0`}>FROM</span>
            <input
              type="date"
              value={fromValue}
              max={toDateInput(now)}
              disabled={!desk}
              onChange={(event) => {
                setRange({ kind: 'custom', from: event.target.value, to: toValue })
              }}
              className={dateField}
            />
          </label>
          <label className="flex items-center gap-2">
            <span className={`${caption} min-w-9 wide:min-w-0`}>TO</span>
            <input
              type="date"
              value={toValue}
              max={toDateInput(now)}
              disabled={!desk}
              onChange={(event) => {
                setRange({ kind: 'custom', from: fromValue, to: event.target.value })
              }}
              className={dateField}
            />
          </label>
        </div>
      </div>

      <FormPanel>
        {usage.status === 'loading' && (
          <div aria-busy="true" className="max-w-[60rem] space-y-3">
            <div className="bg-base-300 h-4 w-40 animate-pulse rounded-[2px]" />
            <div className="bg-base-300 h-[clamp(10rem,45vw,15rem)] animate-pulse rounded-[2px]" />
          </div>
        )}

        {usage.status === 'error' && (
          <p className="text-dim text-sm leading-[1.7]">Couldn't load the filament usage.</p>
        )}

        {resolved && 'problem' in resolved && (
          <p className="text-dim text-sm leading-[1.7]">{resolved.problem}</p>
        )}

        {dates && graph && sum && (
          sum.prints === 0 ? (
            <p className="text-dim text-sm leading-[1.7]">
              No filament prints were finished {dates.phrase}.
            </p>
          ) : (
            <>
              <p className="text-dim mb-6 text-sm leading-[1.7] text-pretty">
                <strong className="text-base-content">{grams(sum.total)}</strong> {dates.phrase},
                from {printsLabel(sum.prints)}: {grams(sum.personal)} personal,{' '}
                {grams(sum.project)} for projects.
              </p>

              <UsageChart
                key={`${range.kind}:${fromValue}:${toValue}`}
                periods={graph.periods}
                scale={graph.scale}
              />

              {sum.unmeasured > 0 && (
                <p className="text-faint mt-5 text-[12.5px] leading-[1.6]">
                  {sum.unmeasured === 1
                    ? '1 finished print has no grams recorded and isn’t in the graph.'
                    : `${String(sum.unmeasured)} finished prints have no grams recorded and aren’t in the graph.`}
                </p>
              )}

              <UsageTable periods={graph.periods} scale={graph.scale} />
            </>
          )
        )}
      </FormPanel>
    </>
  )
}

const SCALE_HEADING: Record<UsageScale, string> = {
  day: 'DAY',
  week: 'WEEK OF',
  month: 'MONTH',
  year: 'YEAR',
}

/**
 * The graph's numbers for the periods that had prints, newest first: what a screen reader gets,
 * and the exact figures.
 */
function UsageTable({ periods, scale }: { periods: UsageBucket[]; scale: UsageScale }) {
  const cell = 'text-dim py-2 pl-2 text-right font-mono whitespace-nowrap tabular-nums wide:pl-3'
  const rows = periods.filter((period) => period.prints > 0).reverse()
  return (
    <div className="mt-8 max-w-[44rem] overflow-x-auto">
      <table className="w-full text-left text-[12px] wide:text-[13px]">
        <caption className="sr-only">Filament per {scale}, newest first</caption>
        <thead>
          <tr className="border-rule text-faint border-b font-mono text-[10px] tracking-[0.14em]">
            <th className="py-2 pr-2 font-medium wide:pr-3">{SCALE_HEADING[scale]}</th>
            {/* On a phone the readout above gives the count, and the other four fit. */}
            <th className="hidden py-2 pl-2 text-right font-medium wide:table-cell wide:pl-3">PRINTS</th>
            <th className="py-2 pl-2 text-right font-medium wide:pl-3">PERSONAL</th>
            <th className="py-2 pl-2 text-right font-medium wide:pl-3">PROJECTS</th>
            <th className="py-2 pl-2 text-right font-medium wide:pl-3">TOTAL</th>
          </tr>
        </thead>
        <tbody className="divide-rule divide-y">
          {rows.map((period) => (
            <tr key={period.start.getTime()}>
              <th scope="row" className="text-base-content py-2 pr-2 font-normal whitespace-nowrap wide:pr-3">
                {periodDate(period.start, scale)}
              </th>
              <td className={`${cell} hidden wide:table-cell`}>{period.prints}</td>
              <td className={cell}>{grams(period.personal)}</td>
              <td className={cell}>{grams(period.project)}</td>
              <td className={`${cell} text-base-content`}>{grams(period.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
