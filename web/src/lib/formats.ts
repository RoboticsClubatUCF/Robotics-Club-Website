/**
 * Formatting helpers shared by the dashboard pages. Small enough to inline
 * anywhere, which is exactly why they live here — three copies of "what is a
 * megabyte" is how two of them end up disagreeing.
 */

/** Bytes as the size a person would say out loud. */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** An ISO instant as a short local date: "6 Aug". */
export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

/** An ISO instant as a local date and time, for queues where both matter. */
export const dateAndTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

/**
 * The theme's status colours, keyed by how a status *reads* rather than by
 * its name: in-flight is informational, good outcomes are green, refusals are
 * red. `index.css` has defined these since the start and nothing used them
 * until there were queues to colour.
 *
 * **`waiting` and `neutral` are not the same thing**, and telling them apart
 * is what this grew for. Something waiting on a person is the only status on
 * a queue that is a job — it is why the page is open — so it takes the
 * theme's amber and can be found by scanning. Cancelled and withdrawn are
 * genuinely neutral: over, nobody's problem, and worth the quietest colour on
 * the page rather than a colour that pulls the eye to a closed row.
 *
 * Amber is not a fifth brand colour: `--color-warning` has been in the palette
 * since the theme was written, picked to clear 4.5:1 against the page, and it
 * sits far enough from UCF gold that a status chip cannot be mistaken for the
 * one accent the site uses for actions.
 */
export const STATUS_TONE = {
  neutral: 'text-faint',
  waiting: 'text-warning',
  progress: 'text-info',
  good: 'text-success',
  bad: 'text-error',
} as const

export type StatusTone = keyof typeof STATUS_TONE
