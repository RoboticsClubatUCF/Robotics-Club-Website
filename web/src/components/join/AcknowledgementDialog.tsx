import { useEffect, useId, useRef } from 'react'
import {
  acknowledgementIntro,
  acknowledgementSections,
} from '../../content/acknowledgement'

/**
 * The member acknowledgement, read without leaving the form.
 *
 * A dialog rather than a route on purpose. The only place this is linked from
 * is the middle of signup, where somebody has already typed a name, a password
 * twice and a Discord handle — navigating away to read the rules and coming
 * back to an empty form is how you get people agreeing to something they never
 * opened. Nothing here unmounts the form behind it.
 *
 * Native `<dialog>` and `showModal()`, so Escape, the backdrop, focus trapping
 * and inertness of the page behind all come from the browser rather than from
 * code that has to be kept right.
 */
export function AcknowledgementDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return

    // Guarded both ways: `showModal()` on an already-open dialog throws, and
    // closing one that is already closed fires a second `close` event.
    if (open) {
      if (!dialog.open) dialog.showModal()
    } else if (dialog.open) {
      dialog.close()
    }
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      /* Every way out lands here — the button below, Escape, the backdrop — so
         this is the only place the parent's state is put back. */
      onClose={onClose}
      onClick={(event) => {
        // A click on the ::backdrop is dispatched at the dialog element itself.
        // All the padding lives on the box inside, so anything whose target is
        // the element is a click outside the visible panel.
        if (event.target === ref.current) ref.current?.close()
      }}
      /* Preflight zeroes the margin every browser gives a dialog, which is what
         centres it — hence `m-auto`. Sizing stays off the `display` property:
         a `flex` here would beat the user-agent's `dialog:not([open])` rule and
         show the panel while it is closed. */
      className="border-rule bg-base-200 m-auto w-[min(38rem,calc(100vw-2rem))] border p-0 text-base-content backdrop:bg-black/80"
    >
      <div className="flex max-h-[min(42rem,calc(100dvh-4rem))] flex-col">
        <div className="border-rule flex shrink-0 items-start justify-between gap-5 border-b px-6 py-5">
          <div>
            <p className="text-faint mb-2 font-mono text-[11px] font-bold tracking-[0.2em]">
              / BEFORE YOU JOIN
            </p>
            <h2 id={titleId} className="text-lg font-bold tracking-[-0.01em]">
              Member acknowledgement
            </h2>
          </div>

          {/* Outside the scrolling region, so the way out does not depend on
              having read to the bottom. */}
          <button
            type="button"
            onClick={() => ref.current?.close()}
            className="text-faint hover:text-primary shrink-0 cursor-pointer pt-1 font-mono text-[11px] font-medium tracking-[0.14em] transition-colors duration-200"
          >
            CLOSE
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <p className="text-dim text-sm leading-[1.7] text-pretty">
            {acknowledgementIntro}
          </p>

          <ol className="mt-7 space-y-6">
            {acknowledgementSections.map((section) => (
              <li key={section.number + section.title} className="flex gap-3">
                {section.number && (
                  <span className="text-primary shrink-0 pt-px font-mono text-[11px] font-medium">
                    {section.number}.
                  </span>
                )}
                <div>
                  {section.title && (
                    <p className="mb-1.5 text-sm font-semibold">
                      {section.title}
                    </p>
                  )}
                  <p className="text-dim text-sm leading-[1.7] text-pretty">
                    {section.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </dialog>
  )
}
