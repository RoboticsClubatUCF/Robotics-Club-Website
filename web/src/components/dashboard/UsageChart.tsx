import { useId, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { grams } from '../../lib/printing'
import { axisDate, axisGrams, periodName, ticks } from '../../lib/printUsage'
import type { UsageBucket, UsageScale } from '../../lib/printUsage'

const printsLabel = (count: number) => (count === 1 ? '1 print' : `${String(count)} prints`)

/**
 * Filament per period, one gold column each.
 *
 * HTML rather than SVG, so the labels stay type at any width; each column is a percentage of the
 * top gridline. A period's numbers show in a tooltip over its column while the pointer is on the
 * graph, or after a tap or keyboard focus, where the arrow keys move between periods. It starts
 * on the latest. Screen readers get the tooltip as the group's description and the table under
 * the graph.
 *
 * Key it by range: the picked index means nothing once the periods change.
 */
export function UsageChart({ periods, scale }: { periods: UsageBucket[]; scale: UsageScale }) {
  const id = useId()
  const [picked, setPicked] = useState(periods.length - 1)
  const [hovering, setHovering] = useState(false)
  const [focused, setFocused] = useState(false)
  const lines = ticks(Math.max(...periods.map((period) => period.total)))
  const top = lines.at(-1) ?? 1
  const current = periods[picked]
  const active = hovering || focused
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

  // A finger leaves the moment it lifts, so only a mouse hides the tooltip by leaving; a tap
  // focuses the graph and the tooltip stays until focus goes elsewhere.
  const leave = (event: PointerEvent) => {
    if (event.pointerType === 'mouse') setHovering(false)
  }

  if (!current) return null

  const centre = (picked + 0.5) / periods.length
  const height = (current.total / top) * 100
  // Over its column, kept inside the graph at either end and under the top edge.
  const tooltipStyle = {
    left: `${String(centre * 100)}%`,
    bottom: `calc(min(${String(height)}%, 100% - 6rem) + 0.5rem)`,
    transform:
      centre < 0.2 ? 'translateX(-1rem)' : centre > 0.8 ? 'translateX(calc(-100% + 1rem))' : 'translateX(-50%)',
  }

  return (
    <div
      role="group"
      tabIndex={0}
      aria-label={`Filament per ${scale}. Arrow keys move between ${scale}s.`}
      aria-describedby={active ? `${id}-tip` : undefined}
      onKeyDown={move}
      onFocus={() => {
        setFocused(true)
      }}
      onBlur={() => {
        setFocused(false)
      }}
      className="focus-visible:outline-primary max-w-[60rem] focus-visible:outline-2 focus-visible:outline-offset-4"
    >
      <div
        className="relative ml-12 h-[clamp(10rem,45vw,15rem)]"
        onPointerEnter={() => {
          setHovering(true)
        }}
        onPointerLeave={leave}
      >
        {lines.map((value) => (
          <div
            key={value}
            aria-hidden="true"
            className="border-rule absolute inset-x-0 border-t"
            style={{ bottom: `${String((value / top) * 100)}%` }}
          >
            <span className="text-faint absolute right-full mr-2 -translate-y-1/2 font-mono text-[10px] whitespace-nowrap tabular-nums">
              {axisGrams(value)}
            </span>
          </div>
        ))}

        <div aria-hidden="true" className="absolute inset-0 flex items-end">
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
                  !active ? 'bg-primary/70' : index === picked ? 'bg-primary' : 'bg-primary/40'
                } ${period.total > 0 ? 'min-h-0.5' : ''}`}
                style={{ height: `${String((period.total / top) * 100)}%` }}
              />
            </div>
          ))}
        </div>

        {active && (
          <div
            id={`${id}-tip`}
            role="tooltip"
            className="border-rule bg-base-100 pointer-events-none absolute z-10 w-max max-w-[15rem] border px-3 py-2"
            style={tooltipStyle}
          >
            <p className="text-faint font-mono text-[10px] font-medium tracking-[0.14em] uppercase">
              {periodName(current.start, scale)}
            </p>
            <p className="text-base-content mt-0.5 text-base font-semibold">
              {grams(current.total)}
            </p>
            <p className="text-dim text-[12px] leading-[1.5]">
              {printsLabel(current.prints)}
              {current.total > 0 && (
                <>
                  <br />
                  {grams(current.personal)} personal, {grams(current.project)} for projects
                </>
              )}
            </p>
          </div>
        )}
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
                  active && index === picked ? 'text-base-content' : 'text-faint'
                }`}
              >
                {axisDate(period.start, scale)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
