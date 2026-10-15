import { useId } from 'react'
import { duration } from '../../lib/slicer/estimate'
import { type SliceLog as Log, labelOf } from '../../lib/training/sliceLog'

const SHOWN = 6

const signed = (value: number, digits: number) => `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(digits)}`

/**
 * A practice task's slices side by side: what changed for each and what Orca made of it, so a
 * change of setting shows up as a change in plastic, time and layers. The newest is marked in
 * gold. Nothing shows until the first slice.
 */
export function SliceLog({ log }: { log: Log }) {
  const id = useId()
  if (log.slices.length === 0) return null
  // A task asks for five slices at most; past that, the oldest give way rather than the plate.
  const shownFrom = Math.max(0, log.slices.length - SHOWN)
  return (
    // One line a slice, beside its heading at `wide`: the strip sits over the plate, and every line it
    // grows by comes off the plate on a laptop. A phone's page scrolls, so the heading goes on top there.
    <section
      aria-labelledby={id}
      data-coach="slice-log"
      className="mt-1.5 flex flex-col gap-1 wide:flex-row wide:items-baseline wide:gap-3"
    >
      <h2 id={id} className="text-faint shrink-0 font-mono text-[10px] font-medium tracking-[0.14em]">
        YOUR SLICES
      </h2>
      <ol start={shownFrom + 1} className="flex min-w-0 flex-wrap gap-x-4 gap-y-1">
        {log.slices.map((slice, index) => {
          if (index < shownFrom) return null
          const before = index > 0 ? log.slices[index - 1]! : null
          const newest = index === log.slices.length - 1
          // Practice parts weigh a few grams, so a brim's difference needs the second decimal.
          const grams = Math.round((slice.grams - (before?.grams ?? slice.grams)) * 100) / 100
          const minutes = Math.round(slice.seconds / 60) - Math.round((before?.seconds ?? slice.seconds) / 60)
          return (
            <li
              key={slice.requestedAt}
              className={`min-w-0 border-l-2 pl-2 text-[12.5px] leading-[1.5] ${
                newest ? 'border-primary text-base-content' : 'border-rule text-dim'
              }`}
            >
              <span className="text-faint font-mono text-[11px]">{index + 1}</span> {labelOf(log, index)}
              <span className="text-dim font-mono text-[11.5px] tabular-nums">
                {' · '}
                {slice.grams.toFixed(2)} g
                {grams !== 0 && <span className="text-faint"> ({signed(grams, 2)})</span>}
                {' · '}
                {duration(slice.seconds)}
                {minutes !== 0 && <span className="text-faint"> ({signed(minutes, 0)})</span>}
                {slice.layers !== null && ` · ${String(slice.layers)} layers`}
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
