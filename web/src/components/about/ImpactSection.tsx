import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ApiAboutStat } from '../../lib/api/api'
import { COUNT_MS, canCountUp, figureAt, splitFigure } from '../../lib/aboutPage'

/**
 * OUR IMPACT: the club's numbers, counting up the first time they scroll into view.
 *
 * Typed by officers rather than counted (see `AboutStat` in the schema), so this is not the landing
 * page's stat strip and doesn't link anywhere. It borrows the strip's look: flush cells with the
 * rules showing through a 1px gap.
 *
 * One observer and one animation frame loop for the whole row, so the cells land together. The
 * count is a `progress` from 0 to 1 that each cell turns into its own figure. Under reduced motion,
 * or without `IntersectionObserver`, it starts at 1 and nothing moves. Screen readers get the
 * figure as written, never the digits on the way.
 */
export function ImpactSection({ stats }: { stats: ApiAboutStat[] }) {
  const list = useRef<HTMLUListElement>(null)
  const [progress, setProgress] = useState(() => (canCountUp() ? 0 : 1))

  useEffect(() => {
    const element = list.current
    if (!element || !canCountUp()) return

    let frame = 0
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer.disconnect()

        const start = performance.now()
        const tick = (now: number) => {
          const next = Math.min(1, (now - start) / COUNT_MS)
          setProgress(next)
          if (next < 1) frame = requestAnimationFrame(tick)
        }
        frame = requestAnimationFrame(tick)
      },
      // As the first row clears the bottom of the screen. Waiting for a share of the whole list
      // left a phone's first row reading "0+" while the rest was still below.
      { rootMargin: '0px 0px -10% 0px' },
    )

    observer.observe(element)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <section className="border-rule px-page border-t py-12 wide:py-18">
      <div className="mb-9">
        <h2 className="text-faint mb-5 font-mono text-[13px] font-bold tracking-[0.2em]">
          / OUR IMPACT
        </h2>
      </div>

      {/* Two columns on a phone, with an odd last cell spanning both so no empty
          rule-coloured hole is left beside it. One row at width, however many
          cells there are, up to `MAX_STATS`.

          The figure is sized from one column's width (the list is a size
          container, `--cols` its column count), so eight characters like
          "$150,000" fit a cell at 900px with six cells and every figure is the
          same size, the phone's spanning cell included. Past that it wraps
          rather than running into the next cell. */}
      <ul
        ref={list}
        style={{ '--stat-columns': stats.length } as CSSProperties}
        className="bg-rule border-rule @container grid grid-cols-2 gap-px border [--cols:2] wide:grid-cols-[repeat(var(--stat-columns),minmax(0,1fr))] wide:[--cols:var(--stat-columns)]"
      >
        {stats.map((stat) => {
          const figure = splitFigure(stat.figure)

          return (
            <li
              key={stat.id}
              className="bg-base-100 p-5 last:odd:col-span-2 wide:last:odd:col-span-1"
            >
              <p className="text-[clamp(1.125rem,calc((100cqi/var(--cols)_-_2.5rem)/4.8),2.5rem)] leading-none font-bold tabular-nums [overflow-wrap:anywhere]">
                <span className="sr-only">{stat.figure}</span>
                <span aria-hidden="true">{figureAt(figure, progress)}</span>
              </p>
              {figure.unit !== '' && (
                <p
                  aria-hidden="true"
                  className="text-primary mt-2.5 font-mono text-[11px] font-medium tracking-[0.14em] uppercase"
                >
                  {figure.unit}
                </p>
              )}
              <p className="text-dim mt-3 text-[13px] leading-[1.55] text-pretty">
                {stat.label}
              </p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
