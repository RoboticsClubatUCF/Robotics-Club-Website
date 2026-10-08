import type { ApiDraft } from '../../lib/api/api'
import { duration } from '../../lib/slicer/estimate'

/**
 * Where the plate is with the slicer, in one line beside SLICE and PRINT: not sliced, waiting,
 * slicing, sliced (with Orca's time and material), out of date, or why it failed.
 */
export function SliceSummary({
  draft,
  workerOnline,
  dirty,
}: {
  draft: ApiDraft | null
  workerOnline: boolean
  /** Edits not saved yet, which a slice can't have seen. */
  dirty: boolean
}) {
  const slice = draft?.slice ?? null
  // Only models with a copy on the plate: one kept for undo isn't sliced.
  const converting = draft?.models.some(
    (model) =>
      (model.meshState === 'QUEUED' || model.meshState === 'RUNNING') &&
      draft.objects.some((object) => object.modelId === model.id),
  )

  let text: string
  let tone = 'text-dim'
  if (!draft || draft.objects.length === 0) {
    text = 'Add a model to start.'
  } else if (converting) {
    text = 'Converting a STEP file…'
  } else if (!slice) {
    text = workerOnline ? 'Not sliced yet.' : 'The slicer is offline. Your plate is saved.'
    if (!workerOnline) tone = 'text-warning'
  } else if (slice.state === 'QUEUED') {
    text = 'Waiting for the slicer…'
  } else if (slice.state === 'RUNNING') {
    text = 'Slicing…'
  } else if (slice.state === 'FAILED') {
    text = slice.failure ?? `The plate couldn't be sliced.`
    tone = 'text-error'
  } else if (!slice.current || dirty) {
    text = 'The plate changed since it was sliced.'
    tone = 'text-warning'
  } else {
    text = `${duration(slice.estimatedSeconds)} · ${slice.estimatedGrams === null ? '?' : slice.estimatedGrams.toFixed(1)} g${
      slice.filamentMeters === null ? '' : ` · ${slice.filamentMeters.toFixed(2)} m`
    }`
    tone = 'text-base-content'
  }

  return (
    <p
      role="status"
      aria-live="polite"
      className={`min-w-0 font-mono text-[11px] leading-snug tracking-[0.06em] wide:truncate ${tone}`}
      title={text}
    >
      {text}
    </p>
  )
}
