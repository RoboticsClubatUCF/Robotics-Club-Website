import { useCallback, useState, type ReactNode } from 'react'
import { ConfirmDialog } from '../shared/ConfirmDialog'

/**
 * Asking before throwing away work.
 *
 * The editor waits for one SAVE and sends nothing before it — deliberately,
 * because a page that publishes half of itself as you touch it is a page nobody
 * can predict. The cost of that decision is this: leaving without pressing the
 * button discards the lot, and doing it in silence reads as the site having
 * eaten the work rather than as a step having been missed.
 *
 * It matters more than it used to. When only the prose waited, walking away lost
 * a paragraph; now it also loses uploaded photographs, a document filled in, and
 * every title typed against a name — so this is the dialog standing between a
 * lead and twenty minutes of it.
 *
 * A hook rather than a component because the exit is not always rendered by the
 * same parent: the editor draws its own, and the create desk wraps the one that
 * finishes setting a project up. Both wrap their action in `guard` and render
 * the same `dialog`, so the wording cannot drift between them.
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
        Nothing on this page has been saved yet — the writing, the pictures, the
        documents and the team titles all go up together when you press SAVE.
        Leaving throws away whatever has changed.
      </p>
    </ConfirmDialog>
  ) : null

  return { guard, dialog }
}
