import { useRef, useState } from 'react'
import { useOutletContext } from 'react-router'
import { SubNav } from '../../components/dashboard/SubNav'
import { PRINT_QUEUE_PAGES } from '../../lib/dashboard/subPages'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import { DuesLocked } from '../../components/dashboard/DuesLocked'
import { OfficerOnly } from '../../components/dashboard/OfficerOnly'
import { UsageBreakdown } from '../../components/dashboard/UsageBreakdown'
import { UsageChart } from '../../components/dashboard/UsageChart'
import { FilterChips } from '../../components/shared/FilterChips'
import { FormEyebrow, FormHeading, FormPanel, measureClass } from '../../components/shared/formChrome'
import { smallQuietButton } from '../../components/slicer/slicerChrome'
import type { ApiPrintUsageDesk } from '../../lib/api/api'
import { useApi } from '../../lib/api/useApi'
import { isOfficer } from '../../lib/auth/session'
import { duesLocked, termLabel } from '../../lib/dues/dues'
import { longDate } from '../../lib/format/formats'
import { grams } from '../../lib/printing'
import {
  PERSONAL,
  breakdown,
  buckets,
  fromDateInput,
  periodDate,
  shown,
  toDateInput,
  totals,
} from '../../lib/printUsage'
import type { UsageBucket, UsageScale, UsageShow } from '../../lib/printUsage'

/**
 * How much filament the club has gone through: grams on finished filament prints, by the day an
 * officer marked them done, personal and project together. Resin isn't counted.
 *
 * The presets fill in FROM and TO, and changing either makes the range custom. The columns are
 * days, weeks, months or years, whichever suits the range's length. SHOW and FILAMENT narrow
 * everything under them, the totals by project or filament included.
 */

const EYEBROW = '/ MANAGE · PRINT QUEUE · FILAMENT USAGE'

type Preset = 'this' | 'last' | 'all'

const PRESETS = [
  { value: 'this', label: 'THIS SEMESTER' },
  { value: 'last', label: 'LAST SEMESTER' },
  { value: 'all', label: 'ALL TIME' },
] as const

type Range = { kind: Preset } | { kind: 'custom'; from: string; to: string }

const dateField =
  'input border-rule bg-base-200 h-11 w-40 px-2 font-mono text-[12px] wide:h-8'

// The same width for all four on a phone, where they stack, so the fields line up.
const caption =
  'text-faint min-w-16 font-mono text-[10px] font-medium tracking-[0.14em] wide:min-w-0'

const selectField =
  'select border-rule bg-base-200 h-11 min-h-11 w-auto max-w-[16rem] py-0 text-[13px] wide:h-8 wide:min-h-8'

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
 * The range as dates, its name over the figures ("Fall 2026 so far") and in the empty state's
 * sentence ("in Fall 2026 so far"). A custom range with a missing or backwards date has no
 * dates, only the sentence saying what to fix.
 */
function resolve(
  range: Range,
  desk: ApiPrintUsageDesk,
  now: Date,
): { from: Date; to: Date; label: string; phrase: string } | { problem: string } {
  if (range.kind === 'custom') {
    const from = fromDateInput(range.from)
    const to = fromDateInput(range.to, true)
    if (!from || !to) return { problem: 'Pick a date for FROM and for TO.' }
    if (from > to) return { problem: 'FROM is after TO. Pick an earlier start.' }
    const span = `${longDate(from.toISOString())} to ${longDate(to.toISOString())}`
    // Days still to come would draw as nothing used.
    return { from, to: to > now ? now : to, label: span, phrase: `from ${span}` }
  }
  const { current, last } = desk.terms
  if (range.kind === 'this') {
    const label = `${termLabel(current)} so far`
    return { from: new Date(current.from), to: now, label, phrase: `in ${label}` }
  }
  if (range.kind === 'last') {
    const label = termLabel(last)
    return { from: new Date(last.from), to: new Date(last.to), label, phrase: `in ${label}` }
  }
  const first = desk.prints[0]?.settledAt
  return first
    ? { from: new Date(first), to: now, label: `Since ${longDate(first)}`, phrase: `since ${longDate(first)}` }
    : { from: now, to: now, label: 'All time', phrase: 'yet' }
}

/** Its own component so the fetch only happens past the gates above. */
function Usage() {
  const usage = useApi<ApiPrintUsageDesk>('/officer/print-usage')
  const [range, setRange] = useState<Range>({ kind: 'this' })
  const [show, setShow] = useState<UsageShow>('all')
  const [filament, setFilament] = useState('')

  const now = new Date()
  const desk = usage.status === 'ready' ? usage.data : null
  const resolved = desk ? resolve(range, desk, now) : null
  const dates = resolved && 'from' in resolved ? resolved : null
  const fromValue = range.kind === 'custom' ? range.from : dates ? toDateInput(dates.from) : ''
  const toValue = range.kind === 'custom' ? range.to : dates ? toDateInput(dates.to) : ''

  const projects = desk
    ? [...desk.projects].sort((a, b) => a.title.localeCompare(b.title))
    : []
  const filaments = desk
    ? [...new Set(desk.prints.map((print) => print.filament))].sort((a, b) => a.localeCompare(b))
    : []
  const visible = desk ? desk.prints.filter((print) => shown(print, show, filament)) : []
  const narrowed = show !== 'all' || filament !== ''

  const graph = dates ? buckets(visible, dates.from, dates.to) : null
  const sum = graph ? totals(graph.periods) : null
  const titles = new Map(projects.map((project) => [project.id, project.title]))
  const byWhat = dates
    ? {
        project: breakdown(visible, dates.from, dates.to, 'project', titles),
        filament: breakdown(visible, dates.from, dates.to, 'filament', titles),
      }
    : null

  return (
    <>
      <FormEyebrow>{EYEBROW}</FormEyebrow>
      <FormHeading>Filament usage.</FormHeading>
      <SubNav label="Print queue pages" pages={PRINT_QUEUE_PAGES} />

      <div className={`${measureClass} mb-6`}>
        <p className="text-dim text-sm leading-[1.7] text-pretty">
          Grams on finished filament prints, by the day they were marked done. Resin isn't counted.
        </p>
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
            <span className={caption}>FROM</span>
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
            <span className={caption}>TO</span>
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

      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2">
          <span className={caption}>SHOW</span>
          <select
            value={show}
            disabled={!desk}
            onChange={(event) => {
              setShow(event.target.value as UsageShow)
            }}
            className={selectField}
          >
            <option value="all">Everything</option>
            <option value="personal">Personal prints</option>
            <option value="projects">Every project</option>
            {projects.length > 0 && (
              <optgroup label="One project">
                {projects.map((project) => (
                  <option key={project.id} value={`project:${project.id}`}>
                    {project.title}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className={caption}>FILAMENT</span>
          <select
            value={filament}
            disabled={!desk}
            onChange={(event) => {
              setFilament(event.target.value)
            }}
            className={selectField}
          >
            <option value="">Any filament</option>
            {filaments.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
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
              {narrowed ? 'No matching prints were' : 'No filament prints were'} finished{' '}
              {dates.phrase}.
            </p>
          ) : (
            <>
              <UsageFigures label={dates.label} sum={sum} />

              <UsageChart
                key={`${range.kind}:${fromValue}:${toValue}`}
                periods={graph.periods}
                scale={graph.scale}
              />

              {byWhat && (
                <UsageBreakdown
                  rows={byWhat}
                  onPick={(by, key) => {
                    if (by === 'filament') setFilament(key)
                    else setShow(key === PERSONAL ? 'personal' : `project:${key}`)
                  }}
                />
              )}

              <UsageTable
                key={`${range.kind}:${fromValue}:${toValue}:${show}:${filament}`}
                periods={graph.periods}
                scale={graph.scale}
              />
            </>
          )
        )}
      </FormPanel>
    </>
  )
}

/**
 * The range's totals, one figure a cell, ruled the way the landing page's stat strip is. Prints
 * with no grams are counted in PRINTS and said under it, since no total includes them.
 */
function UsageFigures({ label, sum }: { label: string; sum: ReturnType<typeof totals> }) {
  const figures = [
    { term: 'TOTAL', value: grams(sum.total), accent: true },
    {
      term: 'PRINTS',
      value: String(sum.prints),
      note: sum.unmeasured > 0 ? `${String(sum.unmeasured)} with no grams recorded` : undefined,
    },
    { term: 'PERSONAL', value: grams(sum.personal) },
    { term: 'PROJECTS', value: grams(sum.project) },
  ]
  return (
    <section aria-label={label} className="mb-8 max-w-[60rem]">
      <p className="text-faint mb-2 font-mono text-[10px] font-medium tracking-[0.16em] uppercase">
        {label}
      </p>
      <dl className="bg-rule border-rule grid grid-cols-2 gap-px border wide:grid-cols-4">
        {figures.map((figure) => (
          <div key={figure.term} className="bg-base-200 px-4 py-3.5">
            <dt className="text-faint font-mono text-[10px] font-medium tracking-[0.16em]">
              {figure.term}
            </dt>
            <dd
              className={`mt-2 text-xl leading-none font-semibold whitespace-nowrap wide:text-2xl ${
                figure.accent ? 'text-primary' : 'text-base-content'
              }`}
            >
              {figure.value}
            </dd>
            {figure.note && (
              <dd className="text-faint mt-1.5 text-[11.5px] leading-[1.4]">{figure.note}</dd>
            )}
          </div>
        ))}
      </dl>
    </section>
  )
}

const SCALE_NAME: Record<UsageScale, string> = {
  day: 'DAY',
  week: 'WEEK',
  month: 'MONTH',
  year: 'YEAR',
}

const SCALE_HEADING: Record<UsageScale, string> = {
  day: 'DAY',
  week: 'WEEK OF',
  month: 'MONTH',
  year: 'YEAR',
}

const PAGE = 5

/**
 * The graph's numbers for the periods that had prints, newest first: the exact figures, and what
 * a screen reader gets. Folded away until asked for, then five at a time. Key it by range and
 * filters, so a new range starts at five again.
 */
function UsageTable({ periods, scale }: { periods: UsageBucket[]; scale: UsageScale }) {
  const [count, setCount] = useState(PAGE)
  const table = useRef<HTMLTableElement>(null)
  const cell = 'text-dim py-2 pl-2 text-right font-mono whitespace-nowrap tabular-nums wide:pl-3'
  const rows = periods.filter((period) => period.prints > 0).reverse()

  const more = () => {
    setCount((current) => current + PAGE)
    // The button goes once the last rows are in; focus goes to the table rather than the page.
    if (count + PAGE >= rows.length) table.current?.focus()
  }

  return (
    <details className="group border-rule mt-8 max-w-[44rem] border-t">
      <summary className="hover:text-primary text-faint flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 py-3 font-mono text-[10px] font-medium tracking-[0.16em] transition-colors duration-200 marker:content-none wide:min-h-0">
        <span>
          TOTALS BY {SCALE_NAME[scale]}
          <span className="text-dim ml-2 tabular-nums">{rows.length}</span>
        </span>
        <span
          aria-hidden="true"
          className="text-primary text-base leading-none transition-transform duration-200 group-open:rotate-45"
        >
          +
        </span>
      </summary>

      <div className="group-open:animate-reveal overflow-x-auto pb-1">
        <table
          ref={table}
          tabIndex={-1}
          className="focus-visible:outline-primary w-full text-left text-[12px] focus-visible:outline-2 wide:text-[13px]"
        >
          <caption className="sr-only">Filament per {scale}, newest first</caption>
          <thead>
            <tr className="border-rule text-faint border-b font-mono text-[10px] tracking-[0.14em]">
              <th className="py-2 pr-2 font-medium wide:pr-3">{SCALE_HEADING[scale]}</th>
              {/* On a phone the graph's tooltip gives the count, and the other four fit. */}
              <th className="hidden py-2 pl-2 text-right font-medium wide:table-cell wide:pl-3">
                PRINTS
              </th>
              <th className="py-2 pl-2 text-right font-medium wide:pl-3">PERSONAL</th>
              <th className="py-2 pl-2 text-right font-medium wide:pl-3">PROJECTS</th>
              <th className="py-2 pl-2 text-right font-medium wide:pl-3">TOTAL</th>
            </tr>
          </thead>
          <tbody className="divide-rule divide-y">
            {rows.slice(0, count).map((period) => (
              <tr key={period.start.getTime()}>
                <th
                  scope="row"
                  className="text-base-content py-2 pr-2 font-normal whitespace-nowrap wide:pr-3"
                >
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

        {count < rows.length && (
          <button type="button" onClick={more} className={`${smallQuietButton} mt-3`}>
            LOAD MORE
          </button>
        )}
      </div>
    </details>
  )
}
