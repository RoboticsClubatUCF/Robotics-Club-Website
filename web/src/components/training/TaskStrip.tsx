import { type ReactNode, useId, useState } from 'react'
import type { Goal } from '../../lib/training/goals'
import { smallQuietButton } from '../slicer/slicerChrome'

/**
 * A practice task, under the practice workspace's top bar: what to do, each goal ticked as it's
 * met, a hint, and the way on. It folds to the next goal, and starts that way on a phone, so the
 * plate has room. NEXT stays outlined: the workspace's own gold button is the one in view.
 */
export function TaskStrip({
  title,
  brief,
  goals,
  achieved,
  hint,
  complete,
  announce,
  onSkipView,
  onStartOver,
  onBack,
  onNext,
}: {
  title: string
  brief: ReactNode
  goals: Goal[]
  achieved: boolean[]
  hint?: ReactNode
  complete: boolean
  /** The goal just met, said to a screen reader. */
  announce: string
  /** Marks the goals that need a drag, a wheel or a pinch as met, for somebody without one. */
  onSkipView: () => void
  onStartOver: () => void
  onBack: () => void
  onNext: () => void
}) {
  const id = useId()
  const [folded, setFolded] = useState(
    () => typeof window.matchMedia === 'function' && !window.matchMedia('(min-width: 56.25rem)').matches,
  )
  const met = achieved.filter(Boolean).length
  const next = achieved.findIndex((done) => !done)
  const viewLeft = goals.some((goal, index) => goal.needs3d === true && !achieved[index])

  return (
    <section aria-labelledby={`${id}-title`} className="border-rule bg-wash border-b px-4 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 flex-1 basis-[20rem]">
          <div className="flex items-baseline gap-3">
            <h1 id={`${id}-title`} data-step-heading tabIndex={-1} className="text-primary font-mono text-[11px] font-semibold tracking-[0.14em] outline-none">
              TRY IT · {title.toUpperCase()}
            </h1>
            <span className="text-faint font-mono text-[10.5px] tracking-[0.1em]">
              {complete ? 'DONE' : `${String(met)} OF ${String(goals.length)}`}
            </span>
            <button
              type="button"
              aria-expanded={!folded}
              aria-controls={`${id}-body`}
              onClick={() => {
                setFolded(!folded)
              }}
              className="text-dim hover:text-base-content -my-2 ml-auto inline-flex min-h-11 cursor-pointer items-center font-mono text-[10.5px] tracking-[0.12em] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary wide:min-h-8"
            >
              {folded ? 'SHOW TASK' : 'HIDE TASK'}
            </button>
          </div>
          {folded && next !== -1 && (
            <p className="text-base-content mt-1 flex gap-2 text-[13.5px] leading-[1.45]">
              <span aria-hidden="true" className="w-3.5 shrink-0 font-mono">
                ›
              </span>
              {goals[next]!.text}
            </p>
          )}
          <div id={`${id}-body`} hidden={folded}>
            <p className="text-dim mt-1 text-[13.5px] leading-[1.5] text-pretty">{brief}</p>
            <ol aria-label="Goals" className="mt-1.5 space-y-1">
              {goals.map((goal, index) => (
                <li
                  key={goal.text}
                  className={`flex gap-2 text-[13.5px] leading-[1.45] ${
                    achieved[index] ? 'text-dim' : index === next ? 'text-base-content' : 'text-faint'
                  }`}
                >
                  <span aria-hidden="true" className={`w-3.5 shrink-0 font-mono ${achieved[index] ? 'text-success' : ''}`}>
                    {achieved[index] ? '✓' : index === next ? '›' : '·'}
                  </span>
                  <span className={achieved[index] ? 'line-through decoration-1' : undefined}>
                    {goal.text}
                    {achieved[index] && <span className="sr-only"> Done.</span>}
                  </span>
                </li>
              ))}
            </ol>
            {viewLeft && (
              <button
                type="button"
                onClick={onSkipView}
                className="text-dim hover:text-base-content mt-1 inline-flex min-h-11 cursor-pointer items-center text-left text-[12.5px] underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary wide:min-h-6"
              >
                No mouse or touch screen? Skip the goals that need one.
              </button>
            )}
            {hint && (
              <details className="mt-1.5">
                <summary className="text-dim hover:text-base-content inline-flex min-h-11 cursor-pointer items-center font-mono text-[10.5px] tracking-[0.12em] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary wide:min-h-6">
                  HINT
                </summary>
                <p className="text-dim pb-1 text-[13px] leading-[1.5] text-pretty">{hint}</p>
              </details>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <button type="button" onClick={onStartOver} className={smallQuietButton}>
            START OVER
          </button>
          <button type="button" onClick={onBack} className={smallQuietButton}>
            BACK
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!complete}
            title={complete ? undefined : 'Finish the goals first.'}
            className={smallQuietButton}
          >
            NEXT
          </button>
        </div>
      </div>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
    </section>
  )
}
