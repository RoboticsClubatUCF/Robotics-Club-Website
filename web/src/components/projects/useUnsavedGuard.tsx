import { useCallback, useState, type ReactNode } from 'react'
import { ConfirmDialog } from '../shared/ConfirmDialog'

/**
 * Asking before throwing away typed text.
 *
 * The editor's write-up and links wait for SAVE — deliberately, because
 * autosaving a textarea is how a half-written sentence becomes the published
 * one. The cost of that decision is this: leaving without pressing it used to
 * discard the lot in silence, which reads as the site having eaten the work
 * rather than as a step having been missed.
 *
 * A hook rather than a component because there are two ways out of edit mode —
 * the button in the page header and the one at the foot of the editor — and
 * they are rendered by different parents. Both wrap their action in `guard`,
 * and both render the same `dialog`, so the wording cannot drift between them.
 *
 * Deliberately not `beforeunload`. That covers closing the tab and nothing
 * else, browsers render it as their own generic sentence, and the case that
 * actually bites is a press inside the page — which is the one this covers.
 */
export function useUnsavedGuard(dirty: boolean) {
  const [pending, setPending] = useState<(() => void) | null>(null)

  /** Run `action`, or ask first when there is something to lose. */
  const guard = useCallback(
    (action: () => void) => () => {
      if (!dirty) {
        action()
        return
      }
      // Stored behind a thunk: `setState` calls a bare function argument to
      // compute the next value, so a function *as* the value has to be wrapped.
      setPending(() => action)
    },
    [dirty],
  )

  const dialog: ReactNode = pending ? (
    <ConfirmDialog
      title="Leave without saving?"
      confirmLabel="DISCARD THEM"
      dismissLabel="KEEP EDITING"
      onConfirm={() => {
        const action = pending
        setPending(null)
        action()
      }}
      onDismiss={() => {
        setPending(null)
      }}
    >
      <p>
        The writing and the links have unsaved changes. Leaving throws them
        away. Pictures are saved as they are changed.
      </p>
    </ConfirmDialog>
  ) : null

  return { guard, dialog }
}
