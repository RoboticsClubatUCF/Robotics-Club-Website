import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import { grams } from '../../lib/printing'
import { axisDate, axisGrams, periodName, ticks } from '../../lib/printUsage'
import type { UsageBucket, UsageScale } from '../../lib/printUsage'

/**
 * Filament per period, one gold column each.
 *
 * HTML rather than SVG, so the labels stay type at any width; each column is a percentage of the
 * top gridline. The line above reads out one period in full. It starts on the current period, and
 * hovering, tapping or the arrow keys pick another. The columns are hidden from screen readers,
 * which get the table under the graph instead.
 *
 * Key it by range: the picked index means nothing once the periods change.
 */
export function UsageChart({ periods, scale }: { periods: UsageBucket[]; scale: UsageScale }) {
  const [picked, setPicked] = useState(periods.length - 1)
  const lines = ticks(Math.max(...periods.map((period) => period.total)))
  const top = lines.at(-1) ?? 1
  const current = periods[picked]
  // A label under every column doesn't fit: about five on a phone and twelve at `wide`, counted
  // from the right so the latest period always has one.
  const phoneEvery = Math.ceil(periods.length / 5)
  const wideEvery = Math.ceil(periods.length / 12)

  const last = periods.length - 1
  const keys: Record<string, (from: number) => number> = {
    ArrowLeft: (from) => from - 1,
    ArrowRight: (from) => from + 1,
    Home: () => 0,
    End: () => last,
  }

  const move = (event: KeyboardEvent) => {
    const to = keys[event.key]
    if (!to) return
    event.preventDefault()
    // From the state, not this render's `picked`: a held key repeats faster than React renders.
    setPicked((from) => Math.min(last, Math.max(0, to(from))))
  }

  if (!current) return null

  return (
    <div className="max-w-[60rem]">
      <p aria-live="polite" className="mb-5">
        <span className="text-faint block font-mono text-[10px] font-medium tracking-[0.16em] uppercase">
          {periodName(current.start, scale)}
        </span>
        <span className="text-base-content text-xl font-semibold tabular-nums">
          {grams(current.total)}
        </span>
        <span className="text-dim text-[13px]">
          {' '}
          · {current.prints === 1 ? '1 print' : `${String(current.prints)} prints`}
          {current.total > 0 &&
            ` · ${grams(current.personal)} personal, ${grams(current.project)} for projects`}
        </span>
      </p>

      <div
        role="group"
        tabIndex={0}
        aria-label={`Filament per ${scale}. Arrow keys move between ${scale}s.`}
        onKeyDown={move}
        className="focus-visible:outline-primary focus-visible:outline-2 focus-visible:outline-offset-4"
      >
        <div aria-hidden="true" className="relative ml-12 h-[clamp(10rem,45vw,15rem)]">
          {lines.map((value) => (
            <div
              key={value}
              className="border-rule absolute inset-x-0 border-t"
              style={{ bottom: `${String((value / top) * 100)}%` }}
            >
              <span className="text-faint absolute right-full mr-2 -translate-y-1/2 font-mono text-[10px] whitespace-nowrap tabular-nums">
                {axisGrams(value)}
              </span>
            </div>
          ))}

          <div className="absolute inset-0 flex items-end">
            {periods.map((period, index) => (
              <div
                key={period.start.getTime()}
                className="flex h-full flex-1 cursor-pointer items-end justify-center px-px"
                onPointerEnter={() => {
                  setPicked(index)
                }}
                onClick={() => {
                  setPicked(index)
                }}
              >
                <div
                  className={`w-full max-w-6 rounded-t-[2px] ${
                    index === picked ? 'bg-primary' : 'bg-primary/55'
                  } ${period.total > 0 ? 'min-h-0.5' : ''}`}
                  style={{ height: `${String((period.total / top) * 100)}%` }}
                />
              </div>
            ))}
          </div>
        </div>

        <div aria-hidden="true" className="mt-2 ml-12 flex h-4">
          {periods.map((period, index) => {
            const fromEnd = periods.length - 1 - index
            const onPhone = fromEnd % phoneEvery === 0
            const onWide = fromEnd % wideEvery === 0
            const shown = onPhone
              ? onWide
                ? ''
                : 'wide:hidden'
              : onWide
                ? 'hidden wide:block'
                : 'hidden'
            return (
              <div key={period.start.getTime()} className="relative flex-1">
                <span
                  className={`${shown} absolute left-1/2 -translate-x-1/2 font-mono text-[10px] whitespace-nowrap ${
                    index === picked ? 'text-base-content' : 'text-faint'
                  }`}
                >
                  {axisDate(period.start, scale)}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
