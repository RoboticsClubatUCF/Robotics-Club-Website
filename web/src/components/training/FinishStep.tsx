import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ApiError } from '../../lib/api/api'
import { smallLoudButton } from '../slicer/slicerChrome'
import { List, P } from './LessonParts'

/** The last step: what to check before every print, and the press that opens the slicer. */
export function FinishStep({
  trained,
  ready,
  onFinish,
}: {
  trained: boolean
  /** Every step before this one is done. */
  ready: boolean
  onFinish: () => Promise<void>
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
        <li>Give tall, thin or tiny parts a brim.</li>
        <li>Pick the filament for the job: PLA for most things, PETG for heat and knocks.</li>
        <li>Slice it, and look at layer 1, the supports and the grams in PREVIEW before you send it.</li>
      </List>

      {trained ? (
        <div className="border-success/40 bg-success/5 mt-6 border p-5">
          <p ref={doneLine} tabIndex={-1} className="mb-1.5 text-[15px] font-semibold outline-none">
            You&rsquo;ve finished the training.
          </p>
          <p className="text-dim mb-4 text-[14px] leading-[1.6]">The slicer is open to you. Come back here any time to look something up.</p>
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
    </>
  )
}
