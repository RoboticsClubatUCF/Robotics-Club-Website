import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ApiError } from '../../lib/api/api'
import { smallLoudButton, smallQuietButton } from '../slicer/slicerChrome'
import { List, P } from './LessonParts'

export interface OptionalChapter {
  id: string
  title: string
  /** What it unlocks, in a few words. */
  unlocks: string
  done: boolean
  started: boolean
}

/**
 * The end of the required chapters: what to check before every print, the press that opens the
 * slicer, and the optional chapters, each of which unlocks its settings. Their last steps lead
 * back here.
 */
export function FinishStep({
  trained,
  ready,
  chapters,
  unlockedNow,
  onFinish,
  onChapter,
}: {
  trained: boolean
  /** Every required step is done. */
  ready: boolean
  chapters: OptionalChapter[]
  /** The title of the optional chapter just finished, on the way back from it. */
  unlockedNow?: string
  onFinish: () => Promise<void>
  onChapter: (id: string) => void
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'finished' | { failed: string }>('idle')
  const doneLine = useRef<HTMLParagraphElement>(null)

  // The button that was pressed is gone; focus goes to what replaced it.
  useEffect(() => {
    if (state === 'finished' && trained) doneLine.current?.focus()
  }, [state, trained])

  const finish = () => {
    setState('busy')
    onFinish().then(
      () => {
        setState('finished')
      },
      (error: unknown) => {
        setState({
          failed:
            error instanceof ApiError && error.status !== 0 && error.detail
              ? error.detail
              : `Couldn't reach the server. Try again in a moment.`,
        })
      },
    )
  }

  return (
    <>
      <P>Before every print:</P>
      <List ordered>
        <li>Turn it so it needs as little support as it can, with a flat face down.</li>
        <li>Think about which way the force will go, and keep it along the layers.</li>
        <li>Slice it, and look at layer 1, the supports and the grams in PREVIEW before you send it.</li>
      </List>

      {trained ? (
        <div className="border-success/40 bg-success/5 mt-6 border p-5">
          <p ref={doneLine} tabIndex={-1} className="mb-1.5 text-[15px] font-semibold outline-none">
            The slicer is open to you.
          </p>
          <p className="text-dim mb-4 text-[14px] leading-[1.6]">Come back here any time to look something up.</p>
          <Link to="/dashboard/print/slicer" className={smallLoudButton}>
            OPEN THE SLICER
          </Link>
        </div>
      ) : (
        <div className="mt-6">
          <button type="button" disabled={!ready || state === 'busy'} onClick={finish} className={smallLoudButton}>
            {state === 'busy' ? 'FINISHING…' : 'FINISH THE TRAINING'}
          </button>
          <p role="status" className={`mt-3 text-[13px] leading-[1.5] ${typeof state === 'object' ? 'text-error' : 'text-faint'}`}>
            {typeof state === 'object'
              ? state.failed
              : ready
                ? 'This opens the slicer for your account.'
                : 'Finish the steps before this one first.'}
          </p>
        </div>
      )}

      <section aria-labelledby="more-settings" className="mt-10">
        {/* Where focus lands back from an optional chapter: what it unlocked, or the list. */}
        <h2
          id="more-settings"
          data-more-settings={unlockedNow ? undefined : ''}
          tabIndex={-1}
          className="text-faint mb-2 scroll-mt-[calc(var(--spacing-nav)+4rem)] font-mono text-[12px] font-bold tracking-[0.2em] outline-none"
        >
          / MORE SETTINGS
        </h2>
        <p className="text-dim mb-4 text-[14px] leading-[1.6] text-pretty">
          Optional. Each one unlocks its settings in the slicer.
        </p>
        {unlockedNow && (
          <p
            data-more-settings=""
            tabIndex={-1}
            className="border-success/40 bg-success/5 mb-4 border px-4 py-3 text-[14px] font-medium outline-none"
          >
            <span aria-hidden="true" className="text-success">
              ✓{' '}
            </span>
            {unlockedNow} unlocked in the slicer.
          </p>
        )}
        <ul className="border-rule border-t">
          {chapters.map((chapter) => (
            <li key={chapter.id} className="border-rule flex items-center gap-3 border-b py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[14.5px] leading-snug font-medium">{chapter.title}</p>
                <p className="text-faint mt-0.5 text-[12.5px] leading-[1.45]">{chapter.unlocks}</p>
                {chapter.done && (
                  <p className="text-success mt-1 font-mono text-[10px] font-semibold tracking-[0.14em]">
                    <span aria-hidden="true">✓ </span>UNLOCKED
                  </p>
                )}
              </div>
              <button
                type="button"
                disabled={!trained}
                aria-label={`${chapter.done ? 'Review' : chapter.started ? 'Continue' : 'Start'} ${chapter.title}`}
                onClick={() => {
                  onChapter(chapter.id)
                }}
                className={`${smallQuietButton} shrink-0`}
              >
                {chapter.done ? 'REVIEW' : chapter.started ? 'CONTINUE' : 'START'}
              </button>
            </li>
          ))}
        </ul>
        {!trained && <p className="text-faint mt-3 text-[13px] leading-[1.5]">They open once you&rsquo;ve finished.</p>}
      </section>
    </>
  )
}
