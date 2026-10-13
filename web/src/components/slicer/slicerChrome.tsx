/**
 * The workspace's repeated class strings. Its controls are denser than the site's forms, because
 * a slicer is a tool people sit in, but they're the same tokens and the same 2px corners.
 */

const actionBase =
  'btn h-auto min-h-11 cursor-pointer px-4 py-2 text-[11px] font-semibold tracking-[0.04em] disabled:opacity-50 wide:min-h-0'

/** The one gold action in view: SLICE PLATE until the plate is sliced, then REQUEST PRINT. */
export const loudButton = `${actionBase} btn-primary btn-cta`

export const quietButton = `${actionBase} btn-outline border-base-content/28 text-base-content hover:border-base-content hover:bg-base-content/6 hover:text-base-content`

export const dangerButton = `${actionBase} btn-outline border-error/40 text-error hover:border-error hover:bg-error/10 hover:text-error`

/** The profiles desk's per-row actions: the same three weights, smaller, since a row has six. */
const smallBase =
  'btn h-auto min-h-11 min-w-11 cursor-pointer px-3 py-1.5 text-[10.5px] font-semibold tracking-[0.06em] disabled:opacity-50 aria-disabled:opacity-50 wide:min-h-0 wide:min-w-0'

export const smallLoudButton = `${smallBase} btn-primary btn-cta`

export const smallQuietButton = `${smallBase} btn-outline border-base-content/28 text-base-content hover:border-base-content hover:bg-base-content/6 hover:text-base-content`

export const smallDangerButton = `${smallBase} btn-outline border-error/40 text-error hover:border-error hover:bg-error/10 hover:text-error`

/** A square icon button on the plate's toolbar. 44px under `wide`, for a thumb. */
export const toolButton =
  'inline-flex size-11 cursor-pointer items-center justify-center border border-transparent text-dim transition-colors duration-150 hover:bg-base-content/6 hover:text-base-content focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40 wide:size-9'

export const toolButtonOn = 'aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary'

export const panelHeading =
  'text-faint font-mono text-[10px] font-medium tracking-[0.16em]'

/** Without a border colour: each field says `border-rule` or `border-error` for itself, since
    the two in one class list leave the rule winning. */
export const smallField =
  'input input-sm bg-base-200 h-11 min-h-11 w-full px-2 font-mono text-[12px] wide:h-8 wide:min-h-8'

export const smallSelect =
  'select select-sm border-rule bg-base-200 h-11 min-h-11 w-full text-[12px] wide:h-8 wide:min-h-8'

export const iconSize = 'size-4 shrink-0'
