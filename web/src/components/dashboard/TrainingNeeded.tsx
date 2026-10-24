import { Link } from 'react-router'
import { FormEyebrow, FormHeading, FormPanel, measureClass } from '../shared/formChrome'

/**
 * What the slicer shows somebody who hasn't done the slicer training. The whole page, for the
 * reason `DuesLocked` gives: every call it would make is refused (`requireSlicerTraining`).
 */
export function TrainingNeeded({ eyebrow }: { eyebrow: string }) {
  return (
    <>
      <FormEyebrow>{eyebrow}</FormEyebrow>
      <FormHeading>Do the slicer training first.</FormHeading>

      <div className={measureClass}>
        <FormPanel tone="accent">
          <p className="mb-1.5 text-sm font-semibold">It&rsquo;s on your profile page.</p>
          <p className="text-dim text-sm leading-[1.7] text-pretty">
            It walks you through the slicer on a practice plate, from moving parts to sending a plate. Finish
            it and the slicer opens. You can stop and pick up where you left off, on any device.
          </p>
          <Link
            to="/dashboard/profile/training"
            className="btn btn-primary btn-cta mt-5 px-7 py-[15px] text-[13px] font-semibold"
          >
            START THE TRAINING
          </Link>
        </FormPanel>
      </div>
    </>
  )
}
