import { useEffect, useId, useRef, type ReactNode } from 'react'

/**
 * A pop-up for a press that didn't work, where the page has no line near the button to say so.
 *
 * The print queue is why it exists: its status line sat under the last card, up to 5,000px below
 * MARK DONE on a phone, so a refused press looked like nothing happened.
 *
 * `ConfirmDialog`'s shell with one button, and not a `<dialog>` for the reason it gives. OK is the
 * only stop, so Tab stays on it. A backdrop click only counts when the press started on the
 * backdrop, or letting go of a text selection over the scrim would close it.
 */
export function ErrorDialog({
  title,
  children,
  returnTo = null,
  onDismiss,
}: {
  /** What didn't happen, naming the thing it didn't happen to. */
  title: string
  /** What the server said, or what to do instead. */
  children: ReactNode
  /** Where focus goes on close, when that isn't whatever opened it: the field
      the message is about, or a button that was disabled while it opened. */
  returnTo?: HTMLElement | null
  onDismiss: () => void
}) {
  const okRef = useRef<HTMLButtonElement>(null)
  const pressedBackdrop = useRef(false)
  const titleId = useId()
  const bodyId = useId()

  // Read through refs so a caller passing fresh values each render doesn't
  // re-run the effect and bounce focus out and back.
  const dismiss = useRef(onDismiss)
  const target = useRef(returnTo)

  useEffect(() => {
    dismiss.current = onDismiss
    target.current = returnTo
  })

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    okRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss.current()

      if (event.key === 'Tab') {
        event.preventDefault()
        okRef.current?.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      // A button whose row reloaded away while this was open is no longer on
      // the page, and focusing it would drop focus on the body.
      const back = target.current?.isConnected ? target.current : opener
      back?.focus?.()
    }
  }, [])

  return (
    <div
      // `items-end` on a phone so the panel sits under the thumb, as
      // `ConfirmDialog`'s does.
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 wide:items-center"
      onPointerDown={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget
      }}
      onClick={(event) => {
        if (pressedBackdrop.current && event.target === event.currentTarget) {
          onDismiss()
        }
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="border-error/40 bg-base-200 w-full max-w-[28rem] border p-6 shadow-2xl"
      >
        <h2
          id={titleId}
          className="mb-3 text-lg leading-snug font-bold text-pretty break-words"
        >
          {title}
        </h2>

        <div
          id={bodyId}
          className="text-dim space-y-2 text-sm leading-[1.7] text-pretty"
        >
          {children}
        </div>

        <div className="mt-6 flex justify-end">
          {/* 44px tall below `wide`, the phone target size. */}
          <button
            ref={okRef}
            type="button"
            onClick={onDismiss}
            className="btn btn-outline h-auto min-h-0 cursor-pointer border-base-content/28 px-5 py-3.5 wide:py-2.5 text-[11px] font-semibold tracking-[0.04em] text-base-content hover:border-base-content hover:bg-base-content/6 hover:text-base-content"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  )
}
