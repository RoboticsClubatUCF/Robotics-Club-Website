import { useState } from 'react'
import { Link } from 'react-router'
import type { ApiMembership } from '../../lib/api/api'
import type { ApiState } from '../../lib/api/useApi'
import { readProgress } from '../../lib/training/progress'
import { FormPanel } from '../shared/formChrome'
import { noteClass, panelLabelClass, panelQuietClass, panelSaveClass } from './profileChrome'

/**
 * The way into the slicer training, which filament prints need. Whether it's finished comes from
 * the server, with the dues standing; how far along somebody is comes from this browser, since
 * that's all the training keeps of the steps on the way.
 */
export function ProfileTrainingPanel({
  userId,
  membership,
}: {
  userId: string
  membership: ApiState<ApiMembership>
}) {
  const [progress] = useState(() => readProgress(userId))
  const done = Math.min(progress.done.length, progress.total)

  return (
    <FormPanel>
      <p className={panelLabelClass}>SLICER TRAINING</p>
      {membership.status === 'loading' ? (
        <div aria-busy="true" className="h-24" />
      ) : membership.status === 'ready' && membership.data.slicerTrained ? (
        <>
          <p className="mb-1 text-sm font-medium">Done. The slicer is open to you.</p>
          <p className={`${noteClass} mb-4`}>Look back through it whenever you want a reminder.</p>
          <Link to="/dashboard/profile/training" className={panelQuietClass}>
            REVIEW IT
          </Link>
        </>
      ) : (
        <>
          <p className="text-dim mb-3 text-[13px] leading-[1.6] text-pretty">
            Needed before your first filament print. It shows you the slicer on a practice plate: moving and
            turning parts, supports, brims and every setting, with tasks and quick questions along the way.
          </p>
          {done > 0 && (
            <>
              <div
                role="progressbar"
                aria-label="Slicer training progress"
                aria-valuemin={0}
                aria-valuemax={progress.total}
                aria-valuenow={done}
                className="bg-base-300 mb-1.5 h-1.5 w-full"
              >
                <div className="bg-primary h-full" style={{ width: `${String((done / progress.total) * 100)}%` }} />
              </div>
              <p className={`${noteClass} mb-4`}>
                {done} of {progress.total} steps done in this browser.
              </p>
            </>
          )}
          <Link to="/dashboard/profile/training" className={panelSaveClass}>
            {done > 0 ? 'CONTINUE' : 'START THE TRAINING'}
          </Link>
        </>
      )}
    </FormPanel>
  )
}
