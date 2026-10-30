/**
 * The print desk's action buttons: the queue's three decisions and the operators page.
 *
 * One shape, three weights: gold for the natural next step, outline for the other move, red for
 * the one that ends the job badly. All the same size, so a row reads as a set of choices rather
 * than a heading with links after it, and 44px tall below `wide`, where they're tapped.
 */
export const actionBase =
  'btn h-auto min-h-0 cursor-pointer px-4 py-2 text-[11px] font-semibold tracking-[0.04em] disabled:opacity-50 max-wide:min-h-11'

export const loudButton = `${actionBase} btn-primary btn-cta`

export const quietButton = `${actionBase} btn-outline border-base-content/28 text-base-content hover:border-base-content hover:bg-base-content/6 hover:text-base-content`

export const dangerButton = `${actionBase} btn-outline border-error/40 text-error hover:border-error hover:bg-error/10 hover:text-error`
