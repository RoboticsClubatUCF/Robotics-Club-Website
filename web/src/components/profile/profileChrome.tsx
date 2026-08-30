import type { ReactNode } from 'react'

/**
 * The bits every panel on the account page repeats.
 *
 * Six panels, six independent writes, and each one needs the same three things:
 * a mono label saying which part of the account it is, a faint line explaining
 * what the change actually does, and somewhere to put the answer. Written once
 * here rather than six times, which is what stops one of them ending up a pixel
 * off — the same argument `formChrome` makes for the task pages.
 *
 * The page-level chrome itself still comes from `shared/formChrome`; this is
 * only what sits *inside* a `FormPanel`.
 */

/** The `/ SECTION` mono label at the top of a panel. */
export const panelLabelClass =
  'text-faint mb-3 font-mono text-[10px] font-medium tracking-[0.16em]'

/** The explanatory line under it, and the wording of every note on the page. */
export const noteClass = 'text-faint text-[13px] leading-[1.6] text-pretty'

/**
 * A panel's save button.
 *
 * Compact and left-aligned, unlike `submitClass`, which is the full-width bar a
 * task page ends with. This page is not a task with one ending — it is six
 * things somebody might change one of — so a stack of full-width gold bars
 * would read as six pages stacked up.
 */
export const panelSaveClass =
  'btn btn-primary btn-cta cursor-pointer px-6 py-2.5 text-[11px] font-semibold disabled:opacity-60'

/** The quieter sibling, for REMOVE and the like. */
export const panelQuietClass =
  'btn btn-outline h-auto min-h-0 cursor-pointer border-base-content/28 px-5 py-2.5 text-[11px] font-semibold tracking-[0.04em] text-base-content transition-[border-color,background-color] duration-200 hover:border-base-content hover:bg-base-content/6 hover:text-base-content disabled:opacity-50'

/** What a panel has to say after a write, and whether it went well. */
export type PanelMessage = { tone: 'ok' | 'error'; text: string } | null

/**
 * The answer line.
 *
 * Always rendered, so the live region exists before it has anything to announce
 * — a `role="status"` added to the page at the moment it gains text is a region
 * screen readers were not watching. `min-h` so the panel does not grow by a
 * line when an answer lands, which on a page of six panels is the whole column
 * jumping under the pointer.
 */
export function PanelStatus({ message }: { message: PanelMessage }) {
  return (
    <p
      role="status"
      className={`mt-3 min-h-5 text-[13px] leading-[1.5] text-pretty ${
        message?.tone === 'error' ? 'text-error' : 'text-primary'
      }`}
    >
      {message?.text}
    </p>
  )
}

/**
 * One fact about the account: a mono label, and the value across from it.
 *
 * Two panels are drawn from these — YOUR STANDING and MEMBER SURVEY — and they
 * are the two that print facts somebody changes *somewhere else*: an officer
 * sets one lot, the survey's own page sets the other. Making them look the same
 * is the point, which is why this sits here rather than as a local helper in
 * whichever of the two was written first.
 *
 * `—` rather than an empty cell for anything genuinely allowed to be null or
 * still loading, because a blank row reads as a value that failed to load. A
 * question somebody *answered* with nothing says so in words instead — see the
 * allergy rows on the survey panel.
 */
export function PanelFact({
  label,
  value,
}: {
  label: string
  value: string | null
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
      <dt className="text-faint font-mono text-[10px] font-medium tracking-[0.14em]">
        {label}
      </dt>
      <dd className="text-dim min-w-0 text-[13px] break-words">
        {value ?? '—'}
      </dd>
    </div>
  )
}

/** A panel: the label, the body, and whatever it has to say afterwards. */
export function ProfilePanel({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="border-rule bg-base-200 border p-5">
      <p className={panelLabelClass}>{label}</p>
      {children}
    </div>
  )
}
