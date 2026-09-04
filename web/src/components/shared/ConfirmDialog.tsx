import { useEffect, useRef, type ReactNode } from 'react'

/**
 * A confirmation the site draws itself, instead of `window.confirm`.
 *
 * The native box is the browser's, not ours: it arrives in the system font at the top of the window
 * with the origin printed above it, it cannot show the numbers a decision turns on, and it blocks
 * the whole page while it is up. For "this deletes the model and puts them 20 g over" that is not
 * enough room, and the one place it appears is the one place somebody is about to do something
 * irreversible.
 *
 * Not a `<dialog>` element. `showModal` is exactly what this wants, and jsdom does not implement it
 * — so the queue's confirmation flow would be the one thing on the page no test could reach. A
 * plain overlay costs the two behaviours `<dialog>` gives for free, both of which are below.
 *
 * What it does that a bare div would not:
 *
 *   - Escape closes it, because a modal that can only be dismissed by aiming at a button is a modal
 *     people click through.
 *   - The backdrop closes it, same reason.
 *   - Focus moves in on open and back out on close, so a keyboard is not left pointing at a button
 *     that is no longer on screen.
 *   - Focus lands on the dismissing button, never the confirming one. Every use of this is
 *     destructive; a stray Enter should do nothing.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  dismissLabel = 'GO BACK',
  tone = 'danger',
  busy = false,
  onConfirm,
  onDismiss,
}: {
  title: string
  /** The body. Sentences, not a heading — the title has already said the act. */
  children: ReactNode
  confirmLabel: string
  /**
   * Deliberately not "CANCEL" by default. Half the confirmations here *are*
   * cancelling something, and a Cancel button beside "Cancel the print?" asks
   * the reader to work out which cancel is which at the exact moment they
   * should not have to.
   */
  dismissLabel?: string
  tone?: 'danger' | 'primary'
  busy?: boolean
  onConfirm: () => void
  onDismiss: () => void
}) {
  const dismissRef = useRef<HTMLButtonElement>(null)
  const titleId = 'confirm-dialog-title'

  useEffect(() => {
    // Remembered before focus moves, so it can go back to the button that
    // opened this rather than to the top of the document.
    const opener = document.activeElement as HTMLElement | null
    dismissRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss()
    }

    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      opener?.focus?.()
    }
  }, [onDismiss])

  return (
    <div
      // The backdrop. `items-end` on a phone so the panel sits under the
      // thumb rather than in the middle of the screen.
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 wide:items-center"
      onClick={onDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        // Or a click inside the panel reaches the backdrop and closes it.
        onClick={(event) => {
          event.stopPropagation()
        }}
        className="border-rule bg-base-200 w-full max-w-[28rem] border p-6 shadow-2xl"
      >
        <h2 id={titleId} className="mb-3 text-lg leading-snug font-bold text-pretty">
          {title}
        </h2>

        <div className="text-dim space-y-2 text-sm leading-[1.7] text-pretty">
          {children}
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-2.5">
          <button
            ref={dismissRef}
            type="button"
            onClick={onDismiss}
            className="btn btn-outline h-auto min-h-0 cursor-pointer border-base-content/28 px-5 py-2.5 text-[11px] font-semibold tracking-[0.04em] text-base-content hover:border-base-content hover:bg-base-content/6 hover:text-base-content"
          >
            {dismissLabel}
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`btn h-auto min-h-0 cursor-pointer px-5 py-2.5 text-[11px] font-semibold tracking-[0.04em] disabled:opacity-50 ${
              tone === 'danger'
                ? 'btn-outline border-error/40 text-error hover:border-error hover:bg-error/10 hover:text-error'
                : 'btn-primary btn-cta'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
