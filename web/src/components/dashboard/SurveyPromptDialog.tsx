import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'

/**
 * The prompt that asks somebody to fill in the member survey.
 *
 * It asks; it does not gate. `requireSurvey` on the server used to refuse every route until the
 * survey was answered — the printers, the officer desks and the dues page with them — which meant
 * the club could not take somebody's money before it had their shirt size. All of that is gone, so
 * the only thing left that can get the club its answers is asking nicely, once.
 *
 * Which is why the checkbox exists. A prompt that returns every time you open the dashboard is one
 * people learn to click through without reading, and that costs the club the answers and annoys the
 * member. So the box is a real promise — it writes `User.surveyPromptDismissedAt` and this never
 * comes up again — and the two standing panels (the overview's and the account page's) are what is
 * left for somebody who changes their mind.
 *
 * A tick is honoured on every way out, Escape included: it is a statement somebody made, not a
 * modifier on the button they happened to press afterwards.
 *
 * Deliberately not a `<dialog>` element, for the reason `ConfirmDialog` gives at length:
 * `showModal` is what this wants and jsdom does not implement it, so the one flow every member hits
 * would be the one flow no test could reach. The two behaviours that costs are rebuilt below, minus
 * backdrop dismiss — a stray click behind the panel should not count as "later", and certainly not
 * as a tick of the box.
 */
export function SurveyPromptDialog({
  onClose,
}: {
  /** `dontAsk` is the checkbox, and it is the caller's job to persist it. */
  onClose: (dontAsk: boolean) => void
}) {
  const laterRef = useRef<HTMLButtonElement>(null)
  const titleId = 'survey-prompt-title'
  const [dontAsk, setDontAsk] = useState(false)

  /**
   * The tick, mirrored out of React state so the Escape handler below reads the current one. That
   * effect binds once — it has to, or every keystroke would re-register the listener — and a
   * `dontAsk` captured in its closure would be the value the box had when the dialog opened.
   */
  const ticked = useRef(false)
  ticked.current = dontAsk

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null

    // Focus lands on LATER rather than on the link, the same rule
    // `ConfirmDialog` follows: whatever a stray Enter does, it should not be
    // a navigation somebody did not ask for.
    laterRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose(ticked.current)
    }

    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      opener?.focus?.()
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 wide:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="border-primary/35 bg-base-200 w-full max-w-[30rem] border p-6 shadow-2xl"
      >
        <p className="text-faint mb-3 font-mono text-[10px] font-medium tracking-[0.16em]">
          MEMBER SURVEY
        </p>

        <h2
          id={titleId}
          className="mb-3 text-lg leading-snug font-bold text-pretty"
        >
          Have you got two minutes for the member survey?
        </h2>

        <div className="text-dim space-y-2 text-sm leading-[1.7] text-pretty">
          <p>
            It is how the club knows what size shirts to order and what it can
            safely feed people at meetings. You are only ever asked once.
          </p>
          {/* Said outright, because the previous version of this dialog was a
              gate and the members who met it know it as one. Somebody who
              believes the dashboard is locked will fill the form in resentfully
              or not come back, and neither is what the club wants out of a
              question about shirt sizes. */}
          <p>
            Nothing is locked behind it &mdash; the printers, the equipment
            shelf and the dues page all work either way.
          </p>
        </div>

        <label className="mt-5 flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={dontAsk}
            onChange={(event) => {
              setDontAsk(event.target.checked)
            }}
            className="checkbox checkbox-sm border-rule checked:border-primary checked:bg-primary checked:text-primary-content mt-0.5 shrink-0"
          />
          <span className="text-dim text-sm leading-[1.6] text-pretty">
            Don&rsquo;t ask me again.
          </span>
        </label>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-2.5">
          <button
            ref={laterRef}
            type="button"
            onClick={() => {
              onClose(dontAsk)
            }}
            className="text-faint cursor-pointer px-2 py-2.5 font-mono text-[11px] font-medium tracking-[0.1em] transition-colors duration-200 hover:text-base-content"
          >
            {/* NOT NOW rather than LATER, and the box beside it is why: LATER
                is a promise to come back, which is exactly the thing somebody
                who has just ticked *don't ask me again* is not making. */}
            NOT NOW
          </button>

          <Link
            to="/dashboard/survey"
            onClick={() => {
              onClose(dontAsk)
            }}
            className="btn btn-primary btn-cta h-auto min-h-0 px-5 py-2.5 text-[11px] font-semibold tracking-[0.04em]"
          >
            FILL IT IN
          </Link>
        </div>
      </div>
    </div>
  )
}
