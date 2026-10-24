import { type ReactNode, useId } from 'react'
import { smallQuietButton } from '../slicer/slicerChrome'

/**
 * A practice task, under the practice workspace's top bar: what it's about, a hint, and the way
 * on. The goals aren't listed here; `GoalCallout` shows the next one beside what to press. NEXT
 * stays outlined: the workspace's own gold button is the one in view. `children` take the strip's
 * full width under it: the task's slices so far, which need the room more than the buttons do.
 */
export function TaskStrip({
  title,
  brief,
  hint,
  complete,
  announce,
  children,
  onStartOver,
  onBack,
  onNext,
}: {
  title: string
  brief?: ReactNode
  hint?: ReactNode
  complete: boolean
  /** The goal just met and the next one, said to a screen reader. */
  announce: string
  children?: ReactNode
  onStartOver: () => void
  onBack: () => void
  onNext: () => void
}) {
  const id = useId()

  return (
    <section aria-labelledby={`${id}-title`} className="border-rule bg-wash border-b px-4 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 flex-1 basis-[20rem]">
          <div className="flex items-baseline gap-3">
            <h1 id={`${id}-title`} data-step-heading tabIndex={-1} className="text-primary font-mono text-[11px] font-semibold tracking-[0.14em] outline-none">
              TRY IT · {title.toUpperCase()}
            </h1>
            {complete && <span className="text-success font-mono text-[10.5px] tracking-[0.1em]">DONE</span>}
          </div>
          {brief && <p className="text-dim mt-1 text-[13.5px] leading-[1.5] text-pretty">{brief}</p>}
          {hint && (
            <details className="mt-0.5">
              <summary className="text-dim hover:text-base-content inline-flex min-h-11 cursor-pointer items-center font-mono text-[10.5px] tracking-[0.12em] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary wide:min-h-6">
                HINT
              </summary>
              <p className="text-dim pb-1 text-[13px] leading-[1.5] text-pretty">{hint}</p>
            </details>
          )}
        </div>
        <div data-coach="task-actions" className="flex shrink-0 flex-wrap items-center gap-1.5">
          <button type="button" onClick={onStartOver} className={smallQuietButton}>
            START OVER
          </button>
          <button type="button" onClick={onBack} className={smallQuietButton}>
            BACK
          </button>
          <button
            type="button"
            data-coach="next"
            onClick={onNext}
            disabled={!complete}
            title={complete ? undefined : 'Finish the task first.'}
            className={smallQuietButton}
          >
            NEXT
          </button>
        </div>
      </div>
      {children}
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
    </section>
  )
}
