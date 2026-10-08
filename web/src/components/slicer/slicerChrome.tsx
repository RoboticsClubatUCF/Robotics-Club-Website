/**
 * The workspace's repeated class strings. Its controls are denser than the site's forms, because
 * a slicer is a tool people sit in, but they're the same tokens and the same 2px corners.
 */

const actionBase =
  'btn h-auto min-h-0 cursor-pointer px-4 py-2 text-[11px] font-semibold tracking-[0.04em] disabled:opacity-50'

/** The one gold action in view: SLICE PLATE until the plate is sliced, then PRINT. */
export const loudButton = `${actionBase} btn-primary btn-cta`

export const quietButton = `${actionBase} btn-outline border-base-content/28 text-base-content hover:border-base-content hover:bg-base-content/6 hover:text-base-content`

export const dangerButton = `${actionBase} btn-outline border-error/40 text-error hover:border-error hover:bg-error/10 hover:text-error`

/** A square icon button on the plate's toolbar. 44px under `wide`, for a thumb. */
export const toolButton =
  'inline-flex size-11 cursor-pointer items-center justify-center border border-transparent text-dim transition-colors duration-150 hover:bg-base-content/6 hover:text-base-content focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40 wide:size-9'

export const toolButtonOn = 'border-primary bg-primary/10 text-primary'

export const panelHeading =
  'text-faint font-mono text-[10px] font-medium tracking-[0.16em]'

export const smallField =
  'input input-sm border-rule bg-base-200 h-8 min-h-8 w-full px-2 font-mono text-[12px]'

export const smallSelect =
  'select select-sm border-rule bg-base-200 h-8 min-h-8 w-full text-[12px]'

export const iconSize = 'size-4 shrink-0'
