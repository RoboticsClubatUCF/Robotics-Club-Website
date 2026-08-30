import { useState } from 'react'
import { explainApiError } from './api/apiErrors'

/**
 * The runner behind the status line every editable section carries: it holds the
 * message, tracks whether a save is in flight, and turns a thrown API error into
 * a sentence.
 *
 * **It is here rather than beside `Status`, the component it feeds, because a
 * module may not export both.** Fast Refresh can only hot-swap a file whose
 * exports are all components, so a hook sitting next to one costs a full page
 * reload — and a reload of the project editor is the half-typed write-up gone.
 * `react/only-export-components` is what says so; the two are still one feature
 * and are imported together everywhere.
 *
 * There is a third copy of this shape in `pages/dashboard/ProjectManagePage.tsx`;
 * folding that one in is a change to a page this does not touch.
 */
export function useSectionStatus() {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setMessage('')
    try {
      await action()
    } catch (error) {
      setMessage(explainApiError(error))
    } finally {
      setBusy(false)
    }
  }

  return { message, busy, setMessage, run }
}
