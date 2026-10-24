import { useEffect, useRef } from 'react'
import { type PlacedStep, isOptional } from '../../lib/training/curriculum'
import { useDialogFocus } from '../../lib/useDialogFocus'

const KIND = { read: 'READ', check: 'QUESTION', try: 'TRY IT', finish: 'FINISH' } as const

/**
 * Every step of the training, by chapter, as a panel over the page, with the optional chapters
 * under their own heading. Completed and restarted tasks stay available; other unfinished steps
 * after the first one not yet done are locked.
 */
export function TrainingContents({
  steps,
  current,
  finished,
  unlocked,
  open,
  onGo,
  onClose,
}: {
  steps: PlacedStep[]
  current: number
  finished: (placed: PlacedStep) => boolean
  /** Chapters done; the optional ones among them have unlocked their settings. */
  unlocked: ReadonlySet<string>
  open: (index: number) => boolean
  onGo: (index: number) => void
  onClose: () => void
}) {
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  useDialogFocus(panel, close, onClose)

  // Opens on the step somebody is on, not on chapter one. Optional: jsdom has no layout.
  useEffect(() => {
    panel.current?.querySelector('[aria-current="step"]')?.scrollIntoView?.({ block: 'center' })
  }, [])

  const chapters = steps.filter((placed, index) => index === 0 || steps[index - 1]!.chapter !== placed.chapter)
  const firstOptional = chapters.find((placed) => isOptional(placed.chapter))

  return (
    <div className="fixed inset-0 z-50 bg-black/70" onClick={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Training contents"
        onClick={(event) => {
          event.stopPropagation()
        }}
        className="border-rule bg-base-100 absolute inset-y-0 right-0 flex w-[min(26rem,100%)] flex-col border-l shadow-2xl"
      >
        <div className="border-rule flex items-center justify-between border-b px-5 py-2">
          <p className="text-faint font-mono text-[11px] font-medium tracking-[0.16em]">CONTENTS</p>
          <button
            ref={close}
            type="button"
            onClick={onClose}
            className="text-dim hover:text-base-content inline-flex min-h-11 cursor-pointer items-center font-mono text-[11px] tracking-[0.12em] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            CLOSE
          </button>
        </div>
        <ol className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
          {chapters.map((first) => (
            <li key={first.chapter.id} className="mb-3">
              {first === firstOptional && (
                <p className="border-rule text-faint mx-3 mt-5 mb-3 border-t pt-4 font-mono text-[11px] font-bold tracking-[0.16em]">
                  / OPTIONAL
                </p>
              )}
              <p className="text-faint px-3 pb-1 font-mono text-[10px] font-medium tracking-[0.16em]">
                {isOptional(first.chapter) ? '' : `${String(first.chapterIndex + 1).padStart(2, '0')} · `}
                {first.chapter.title.toUpperCase()}
                {isOptional(first.chapter) && unlocked.has(first.chapter.id) && (
                  <span className="text-success"> · UNLOCKED</span>
                )}
              </p>
              <ol>
                {steps
                  .filter((placed) => placed.chapter === first.chapter)
                  .map((placed) => {
                    const done = finished(placed)
                    const here = placed.index === current
                    return (
                      <li key={placed.step.id}>
                        <button
                          type="button"
                          disabled={!open(placed.index)}
                          aria-current={here ? 'step' : undefined}
                          onClick={() => {
                            onGo(placed.index)
                          }}
                          className={`flex min-h-11 w-full cursor-pointer items-center gap-3 border-l-2 px-3 py-1.5 text-left text-[14px] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed wide:min-h-9 ${
                            here ? 'border-primary bg-primary/8 text-primary' : 'border-transparent hover:bg-base-content/5'
                          } ${open(placed.index) ? '' : 'text-faint'}`}
                        >
                          <span aria-hidden="true" className={`w-3 shrink-0 font-mono ${done ? 'text-success' : ''}`}>
                            {done ? '✓' : ''}
                          </span>
                          <span className="min-w-0 flex-1">{placed.step.title}</span>
                          <span className="text-faint shrink-0 font-mono text-[9.5px] tracking-[0.12em]">
                            {open(placed.index) ? KIND[placed.step.kind] : 'LOCKED'}
                            {done && <span className="sr-only">, done</span>}
                          </span>
                        </button>
                      </li>
                    )
                  })}
              </ol>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
