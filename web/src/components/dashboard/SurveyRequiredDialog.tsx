import { useEffect, useRef } from 'react'
import { Link } from 'react-router'

/**
 * The prompt that goes up over the dashboard while the member survey is owed.
 *
 * **It prompts; it does not gate.** What actually refuses is `requireSurvey` in
 * `server/src/auth/authz.ts`, and what greys the rail out is `accessLock`. This is
 * the thing that tells somebody *why*, at the moment they arrive, instead of
 * leaving them to work it out from a column of padlocks.
 *
 * That split is why LATER exists. A prompt with no way past it would trap
 * somebody on the profile page — which is where signing out lives — and a
 * modal that cannot be dismissed is one people learn to click through anyway.
 * Dismissing changes nothing: every lock stays, every route still 403s, and the
 * note at the bottom of the rail goes on naming the way through.
 *
 * Deliberately **not** a `<dialog>` element, for the reason `ConfirmDialog`
 * gives at length: `showModal` is what this wants and jsdom does not implement
 * it, so the one flow every member hits would be the one flow no test could
 * reach. The two behaviours that costs are rebuilt below, minus backdrop
 * dismiss — a stray click behind the panel should not count as "later".
 */
export function SurveyRequiredDialog({ onLater }: { onLater: () => void }) {
  const laterRef = useRef<HTMLButtonElement>(null)
  const titleId = 'survey-required-title'

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null

    // Focus lands on LATER rather than on the link, the same rule
    // `ConfirmDialog` follows: whatever a stray Enter does, it should not be
    // a navigation somebody did not ask for.
    laterRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onLater()
    }

    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      opener?.focus?.()
    }
  }, [onLater])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 wide:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="border-primary/35 bg-base-200 w-full max-w-[30rem] border p-6 shadow-2xl"
      >
        <p className="text-faint mb-3 font-mono text-[10px] font-medium tracking-[0.16em]">
          ONE THING FIRST
        </p>

        <h2
          id={titleId}
          className="mb-3 text-lg leading-snug font-bold text-pretty"
        >
          We need you to fill in the member survey.
        </h2>

        <div className="text-dim space-y-2 text-sm leading-[1.7] text-pretty">
          <p>
            It is about two minutes, and you are only ever asked once. It is how
            the club knows what size shirts to order and what it can safely feed
            people at meetings.
          </p>
          <p>
            Everything else on the dashboard &mdash; the printers, the equipment
            shelf and the dues page &mdash; opens as soon as it is in.
          </p>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-2.5">
          <button
            ref={laterRef}
            type="button"
            onClick={onLater}
            className="text-faint cursor-pointer px-2 py-2.5 font-mono text-[11px] font-medium tracking-[0.1em] transition-colors duration-200 hover:text-base-content"
          >
            LATER
          </button>

          <Link
            to="/dashboard/survey"
            onClick={onLater}
            className="btn btn-primary btn-cta h-auto min-h-0 px-5 py-2.5 text-[11px] font-semibold tracking-[0.04em]"
          >
            FILL IT IN
          </Link>
        </div>
      </div>
    </div>
  )
}
