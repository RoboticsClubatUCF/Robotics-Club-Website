/** Class strings the board panels share, matching the rest of the roles desk. */

export const panelLabel = 'text-faint font-mono text-[10px] font-medium tracking-[0.16em]'

export const primaryButton =
  'btn btn-primary btn-cta px-5 py-2.5 text-[12px] font-semibold disabled:opacity-60'

/* The `disabled:` colours undo `text-base-content`, which otherwise beats DaisyUI's own
   disabled look and leaves a dead button reading as a live one. */
export const secondaryButton =
  'btn btn-outline h-auto min-h-0 border-base-content/28 px-5 py-2.5 text-[12px] font-semibold text-base-content hover:border-base-content hover:bg-base-content/6 hover:text-base-content disabled:opacity-60 disabled:border-base-content/15 disabled:text-base-content/40 disabled:cursor-default'

/** A word-sized action inside a row, the same as MemberSearch's CHANGE. */
export { inlineActionClass as textButton } from '../shared/formChrome'
