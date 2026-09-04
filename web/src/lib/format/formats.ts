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

/**
 * The same with the year, for a date somebody may be reading years later.
 *
 * The member agreement is the caller: "Accepted 6 Aug" is ambiguous the moment
 * an account is more than one August old, and the whole reason that timestamp
 * is stored is so the club can produce it afterwards.
 */
export const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })

/**
 * How long ago something happened: "just now", "20 min ago", "3 hr ago", and the date itself once
 * it is more than a day old.
 *
 * For a status somebody is deciding something on — is the lab open — where the useful fact is not
 * when it was flipped but how stale the claim is. Past a day that stops being true and the date is
 * the more honest thing to print, so this hands over to `shortDate`.
 *
 * `now` is an argument for the same reason the server's semester functions take one: arithmetic
 * tested against the wall clock passes in the afternoon and fails at midnight.
 */
export function ago(iso: string, now: number = Date.now()): string {
  // Never negative. A clock a few seconds behind the server's would otherwise
  // print "-1 min ago", which reads as a bug rather than as a rounding
  // difference nobody cares about.
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))

  if (seconds < 60) return 'just now'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hr ago`

  return shortDate(iso)
}

/** An ISO instant as a local date and time, for queues where both matter. */
export const dateAndTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

/**
 * The theme's status colours, keyed by how a status reads rather than by its name: in-flight is
 * informational, good outcomes are green, refusals are red. `index.css` has defined these since the
 * start and nothing used them until there were queues to colour.
 *
 * `waiting` and `neutral` are not the same thing, and telling them apart is what this grew for.
 * Something waiting on a person is the only status on a queue that is a job — it is why the page is
 * open — so it takes the theme's amber and can be found by scanning. Cancelled and withdrawn are
 * genuinely neutral: over, nobody's problem, and worth the quietest colour on the page rather than
 * one that pulls the eye to a closed row.
 *
 * Amber is not a fifth brand colour: `--color-warning` has been in the palette since the theme was
 * written, picked to clear 4.5:1 against the page, and it sits far enough from UCF gold that a
 * status chip cannot be mistaken for the one accent the site uses for actions.
 */
export const STATUS_TONE = {
  neutral: 'text-faint',
  waiting: 'text-warning',
  progress: 'text-info',
  good: 'text-success',
  bad: 'text-error',
} as const

export type StatusTone = keyof typeof STATUS_TONE
