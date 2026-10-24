import { Link } from 'react-router'
import type { ApiMembership, ApiTraining } from '../../lib/api/api'
import { type ApiState, useApi } from '../../lib/api/useApi'
import { OPTIONAL_CHAPTERS, REQUIRED_CHAPTERS, chapterLink } from '../../lib/slicer/trainingChapters'
import { FormPanel } from '../shared/formChrome'
import { noteClass, panelLabelClass, panelQuietClass, panelSaveClass } from './profileChrome'

/**
 * The way into the slicer training, which filament prints need. Whether its required chapters
 * are done comes with the dues standing; how far along somebody is, and which optional chapters
 * they've unlocked, from the training's own record on the server. Without that record the panel
 * still offers the way in, just without the count.
 */
export function ProfileTrainingPanel({ membership }: { membership: ApiState<ApiMembership> }) {
  const training = useApi<ApiTraining>('/print/training')
  const record = training.status === 'ready' ? training.data : null
  const count = (ids: readonly string[]) => ids.filter((id) => record?.chapters.includes(id)).length
  const required = count(REQUIRED_CHAPTERS)
  const unlocked = count(OPTIONAL_CHAPTERS)
  const started = record !== null && (record.steps.length > 0 || record.at !== null)

  return (
    <FormPanel>
      <p className={panelLabelClass}>SLICER TRAINING</p>
      {membership.status === 'loading' || training.status === 'loading' ? (
        // Held until both are in, so the button doesn't change its word under the pointer.
        <div aria-busy="true" className="h-24" />
      ) : membership.status === 'ready' && membership.data.slicerTrained ? (
        <>
          <p className="mb-1 text-sm font-medium">Done. The slicer is open to you.</p>
          {record && (
            <p className={`${noteClass} mb-4`}>
              {unlocked === OPTIONAL_CHAPTERS.length
                ? 'Every setting is unlocked.'
                : `${String(unlocked)} of ${String(OPTIONAL_CHAPTERS.length)} optional chapters done. Each unlocks more settings.`}
            </p>
          )}
          {record && unlocked < OPTIONAL_CHAPTERS.length ? (
            // The list of optional chapters, wherever they last were.
            <Link to={chapterLink('finish')} className={panelQuietClass}>
              MORE SETTINGS
            </Link>
          ) : (
            <Link to="/dashboard/profile/training" className={`${panelQuietClass} ${record ? '' : 'mt-3'}`}>
              REVIEW IT
            </Link>
          )}
        </>
      ) : (
        <>
          <p className="text-dim mb-3 text-[13px] leading-[1.6] text-pretty">
            Needed before your first filament print: the slicer on a practice plate, from moving parts to sending a
            plate. Settings past the basics unlock a chapter at a time.
          </p>
          {started && (
            <>
              <div
                role="progressbar"
                aria-label="Slicer training progress"
                aria-valuemin={0}
                aria-valuemax={REQUIRED_CHAPTERS.length}
                aria-valuenow={required}
                className="bg-base-300 mb-1.5 h-1.5 w-full"
              >
                <div
                  className="bg-primary h-full"
                  style={{ width: `${String((required / REQUIRED_CHAPTERS.length) * 100)}%` }}
                />
              </div>
              <p className={`${noteClass} mb-4`}>
                {required} of {REQUIRED_CHAPTERS.length} chapters done.
              </p>
            </>
          )}
          <Link to="/dashboard/profile/training" className={panelSaveClass}>
            {started ? 'CONTINUE' : 'START THE TRAINING'}
          </Link>
        </>
      )}
    </FormPanel>
  )
}
