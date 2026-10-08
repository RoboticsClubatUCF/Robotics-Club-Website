import { useId, useState } from 'react'
import type { ApiMyProject, ApiPrintAllowance } from '../../lib/api/api'
import { chargedGrams, duration } from '../../lib/slicer/estimate'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { labelClass } from '../shared/formChrome'

/**
 * Sending the sliced plate to the officers. The estimate is what a personal print will cost, so
 * it's set against what's left before anything is sent; going over is allowed, and the officer
 * decides, as it always has been.
 */
export function SubmitDialog({
  grams,
  seconds,
  projects,
  allowance,
  busy,
  onSubmit,
  onDismiss,
}: {
  grams: number
  seconds: number | null
  projects: ApiMyProject[]
  allowance: ApiPrintAllowance | null
  busy: boolean
  onSubmit: (details: { projectId: string | null; notes: string }) => void
  onDismiss: () => void
}) {
  const id = useId()
  const [projectId, setProjectId] = useState('')
  const [notes, setNotes] = useState('')
  const charge = chargedGrams(grams)
  const personal = projectId === ''
  const over = personal && allowance ? charge - allowance.remainingGrams : 0

  return (
    <ConfirmDialog
      title="Send this plate to the officers?"
      confirmLabel={busy ? 'SENDING…' : 'SEND IT'}
      dismissLabel="KEEP EDITING"
      tone="primary"
      busy={busy}
      onConfirm={() => {
        onSubmit({ projectId: projectId || null, notes })
      }}
      onDismiss={onDismiss}
    >
      <p className="text-dim mb-4 text-sm leading-[1.6]">
        About {duration(seconds)} and {charge} g. An officer downloads the sliced file and prints
        it; you can take it back to edit until they start.
      </p>

      <label htmlFor={`${id}-project`} className={labelClass}>
        WHAT IT IS FOR
      </label>
      <select
        id={`${id}-project`}
        value={projectId}
        onChange={(event) => {
          setProjectId(event.target.value)
        }}
        className="select border-rule bg-base-100 mb-1.5 w-full text-sm"
      >
        <option value="">Personal print</option>
        {projects.map((membership) => (
          <option key={membership.project.id} value={membership.project.id}>
            {membership.project.title}
          </option>
        ))}
      </select>
      <p className={`mb-4 text-[12px] leading-[1.5] ${over > 0 ? 'text-error' : 'text-faint'}`}>
        {!personal
          ? `Not counted against your allowance.`
          : !allowance
            ? `Comes out of your allowance for the semester.`
            : over > 0
              ? `That's ${String(over)} g past what you have left. An officer decides whether to print it.`
              : `Leaves ${String(allowance.remainingGrams - charge)} g of your allowance.`}
      </p>

      <label htmlFor={`${id}-notes`} className={labelClass}>
        SPECIAL REQUESTS
      </label>
      <textarea
        id={`${id}-notes`}
        rows={2}
        maxLength={1000}
        value={notes}
        onChange={(event) => {
          setNotes(event.target.value)
        }}
        placeholder="Black if there is any."
        className="textarea border-rule bg-base-100 mb-2 w-full text-sm"
      />
    </ConfirmDialog>
  )
}
