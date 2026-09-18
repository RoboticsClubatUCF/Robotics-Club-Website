import { useEffect, useRef, useState, type ReactNode } from 'react'
import { labelClass } from '../shared/formChrome'
import {
  WEEKDAY_NAMES,
  WEEKDAY_SHORT,
  formatCivilDate,
  todayCivil,
} from '../../lib/events/meetings'
import {
  type Month,
  type TermBounds,
  compareMonths,
  monthGrid,
  monthOf,
  openingMonth,
  pickerRange,
  sameDayIn,
  shiftDate,
  shiftMonth,
  weekdayOf,
  whyNot,
} from '../../lib/events/meetingDates'

/** Why a greyed day is greyed: read out after its date, and its tooltip. */
const WHY = {
  past: 'already past',
  outside: 'outside the semester',
  finals: 'finals week',
} as const

/** Arrow keys move a day or a week, the way every date grid does. */
const STEPS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
}

/**
 * A month grid a lead clicks the meeting days on, for a schedule that's a list of dates.
 *
 * Days are toggle buttons (`aria-pressed`) in a real table, so a screen reader hears the
 * weekday column and whether the day is picked. One day is in the tab order at a time and the
 * arrow keys move between them, crossing into the next month at the edge; Home and End go to
 * the ends of the week and PageUp and PageDown change month. Greyed days are the ones the server would refuse, and they stay
 * focusable so the arrows don't skip over a week of them. A picked day can always be
 * unpicked, even once it's past.
 *
 * The picked dates are listed under the grid too, since they can span months and the grid
 * shows one.
 */
export function MeetingDatesPicker({
  dates,
  onChange,
  disabled,
  bounds,
}: {
  dates: string[]
  onChange: (dates: string[]) => void
  disabled: boolean
  /** The term's days, or null while they load or if they couldn't be read. */
  bounds: TermBounds | null
}) {
  const today = todayCivil()
  const range = pickerRange(today, bounds)
  const [view, setView] = useState<Month>(() => openingMonth(dates, today, bounds))
  const [active, setActive] = useState<string | null>(null)
  const days = useRef(new Map<string, HTMLButtonElement>())
  const moved = useRef(false)
  const chips = useRef(new Map<string, HTMLButtonElement>())
  /** Where focus goes once a removed chip has gone: the next chip, or the grid. */
  const afterRemove = useRef<string | null>(null)

  // Held inside the range at render rather than by an effect: the term's dates can land
  // after the grid first draws, and a project for next semester would otherwise open on a
  // month of greyed days.
  const shown =
    compareMonths(view, range.from) < 0
      ? range.from
      : compareMonths(view, range.to) > 0
        ? range.to
        : view

  const grid = monthGrid(shown)
  const inView = grid.flat().filter((day): day is string => day !== null)
  const focusable =
    (active && inView.includes(active) && active) ||
    inView.find((day) => dates.includes(day) && day >= today) ||
    (inView.includes(today) ? today : inView.find((day) => !whyNot(day, today, bounds))) ||
    inView[0]!

  // Focus follows the arrow keys once the grid has redrawn, which it may have done for a
  // new month.
  useEffect(() => {
    if (!moved.current || !active) return
    moved.current = false
    days.current.get(active)?.focus()
  }, [active, shown.year, shown.month])

  useEffect(() => {
    const target = afterRemove.current
    if (target === null) return
    afterRemove.current = null
    ;(chips.current.get(target) ?? days.current.get(focusable))?.focus()
  }, [dates, focusable])

  const monthLabel = new Date(shown.year, shown.month - 1, 1).toLocaleDateString(
    undefined,
    { month: 'long', year: 'numeric' },
  )

  const toggle = (date: string) => {
    setActive(date)
    onChange(
      dates.includes(date)
        ? dates.filter((each) => each !== date)
        : [...dates, date].sort(),
    )
  }

  const move = (from: string, key: string): string | null => {
    if (key in STEPS) return shiftDate(from, STEPS[key]!)
    if (key === 'PageUp') return sameDayIn(from, shiftMonth(monthOf(from), -1))
    if (key === 'PageDown') return sameDayIn(from, shiftMonth(monthOf(from), 1))
    if (key === 'Home') return shiftDate(from, -weekdayOf(from))
    if (key === 'End') return shiftDate(from, 6 - weekdayOf(from))
    return null
  }

  const go = (month: Month) => {
    setView(month)
    setActive(null)
  }

  const atStart = compareMonths(shown, range.from) <= 0
  const atEnd = compareMonths(shown, range.to) >= 0

  return (
    <fieldset>
      <legend className={labelClass}>DATES</legend>

      <div className="max-w-[22rem]">
        <div className="flex items-center justify-between gap-2">
          <p
            aria-live="polite"
            className="font-mono text-[11px] font-medium tracking-[0.14em] uppercase"
          >
            {monthLabel}
          </p>
          <div className="flex gap-1.5">
            <MonthStep
              label="Previous month"
              disabled={disabled}
              atEdge={atStart}
              onClick={() => {
                go(shiftMonth(shown, -1))
              }}
            >
              ‹
            </MonthStep>
            <MonthStep
              label="Next month"
              disabled={disabled}
              atEdge={atEnd}
              onClick={() => {
                go(shiftMonth(shown, 1))
              }}
            >
              ›
            </MonthStep>
          </div>
        </div>

        <table
          className="mt-2 w-full table-fixed border-collapse"
          aria-label={`Meeting dates in ${monthLabel}`}
        >
          <thead>
            <tr>
              {WEEKDAY_SHORT.map((short, index) => (
                <th
                  key={short}
                  scope="col"
                  abbr={WEEKDAY_NAMES[index]}
                  className="text-faint pb-1 text-center font-mono text-[9px] font-medium tracking-[0.14em]"
                >
                  {short}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((week, row) => (
              <tr key={row}>
                {week.map((date, column) => {
                  if (!date) return <td key={column} />

                  const picked = dates.includes(date)
                  const reason = whyNot(date, today, bounds)
                  const closed = reason !== null && !picked

                  return (
                    <td key={column} className="p-px">
                      <button
                        ref={(node) => {
                          if (node) days.current.set(date, node)
                          else days.current.delete(date)
                        }}
                        type="button"
                        tabIndex={date === focusable ? 0 : -1}
                        aria-pressed={picked}
                        aria-disabled={closed || undefined}
                        aria-current={date === today ? 'date' : undefined}
                        title={reason ? WHY[reason] : undefined}
                        aria-label={`${formatCivilDate(date, {
                          weekday: 'long',
                          month: 'long',
                          day: 'numeric',
                        })}${reason ? `, ${WHY[reason]}` : ''}`}
                        disabled={disabled}
                        onClick={() => {
                          if (!closed) toggle(date)
                        }}
                        onKeyDown={(key) => {
                          const next = move(date, key.key)
                          if (!next) return
                          key.preventDefault()
                          const month = monthOf(next)
                          if (
                            compareMonths(month, range.from) < 0 ||
                            compareMonths(month, range.to) > 0
                          ) {
                            return
                          }
                          moved.current = true
                          setActive(next)
                          setView(month)
                        }}
                        // The ring is ink on a picked day: gold on gold is no ring at all.
                        className={`relative flex h-11 w-full items-center justify-center font-mono text-[11px] font-medium transition-colors duration-200 focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 disabled:opacity-60 wide:h-9 ${
                          picked
                            ? 'focus-visible:outline-base-content'
                            : 'focus-visible:outline-primary'
                        } ${
                          date === today ? 'underline decoration-2 underline-offset-4' : ''
                        } ${
                          picked
                            ? reason
                              ? 'bg-primary/30 text-base-content cursor-pointer'
                              : 'bg-primary text-primary-content cursor-pointer'
                            : closed
                              ? 'text-faint cursor-default'
                              : 'text-base-content hover:bg-wash hover:text-primary cursor-pointer'
                        }`}
                      >
                        {Number(date.slice(8))}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>

        <p className="text-faint mt-2 text-[12px] leading-[1.5] text-pretty">
          {bounds
            ? `Greyed days are past, outside the semester${bounds.finals ? ' or in finals week' : ''}.`
            : 'Greyed days are past.'}
        </p>
      </div>

      {dates.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Picked dates">
          {dates.map((date) => {
            const label = formatCivilDate(date, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })
            return (
              <li
                key={date}
                className="border-rule text-dim flex items-center border pl-3 font-mono text-[10px] font-medium tracking-[0.14em] uppercase"
              >
                {label}
                <button
                  ref={(node) => {
                    if (node) chips.current.set(date, node)
                    else chips.current.delete(date)
                  }}
                  type="button"
                  aria-label={`Remove ${label}`}
                  disabled={disabled}
                  onClick={() => {
                    // The chip goes, and focus would go with it to the top of the page.
                    // The next chip takes it, so clearing several is Enter, Enter, Enter.
                    const at = dates.indexOf(date)
                    afterRemove.current = dates[at + 1] ?? dates[at - 1] ?? ''
                    onChange(dates.filter((each) => each !== date))
                  }}
                  className="text-faint hover:text-error focus-visible:outline-primary flex min-h-11 min-w-11 cursor-pointer items-center justify-center text-sm transition-colors duration-200 focus-visible:outline-2 focus-visible:-outline-offset-2 wide:min-h-8 wide:min-w-8"
                >
                  <span aria-hidden>×</span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-faint mt-3 text-[12px]">No dates picked yet.</p>
      )}
    </fieldset>
  )
}

/**
 * The month arrows, 44px on a phone like the site's other calendar.
 *
 * At the end of the range an arrow is `aria-disabled` rather than `disabled`: the one
 * somebody pressed to get there still has focus, and disabling it would drop that focus on
 * the page.
 */
function MonthStep({
  label,
  disabled,
  atEdge,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  atEdge: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-disabled={atEdge || undefined}
      disabled={disabled}
      onClick={() => {
        if (!atEdge) onClick()
      }}
      className={`border-rule text-dim focus-visible:outline-primary flex size-11 items-center justify-center border text-lg leading-none transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40 wide:size-8 ${
        atEdge
          ? 'cursor-default opacity-40'
          : 'hover:border-primary hover:text-primary cursor-pointer'
      }`}
    >
      {children}
    </button>
  )
}
