import type { ApiTask, TaskStatus } from './api/api'
import { SETTLED_TASK } from './api/api'
import type { StatusTone } from './format/formats'

/**
 * What the five task labels are called and how they read, in one place.
 *
 * The mirror of `TaskStatus` in `schema.prisma`, in the sense `lib/printing.ts` and `lib/survey.ts`
 * are mirrors: the server is what actually refuses, and this exists so four screens — the tasks
 * page, the project board, a project's own page and the overview card — cannot disagree about what
 * DELAYED looks like. Written out four times they would agree until one of them was edited.
 */

/**
 * The order is the enum's, which is also the order rows arrive in. Not
 * alphabetised, and not "most common first" like `EVENT_TYPES`: here the
 * sequence is the meaning, running from untouched work to work nobody has to
 * think about again.
 */
export const TASK_STATUSES: readonly TaskStatus[] = [
  'OPEN',
  'IN_PROGRESS',
  'DELAYED',
  'DONE',
  'CANCELED',
]

/**
 * Tones follow `STATUS_TONE`'s rule — keyed by how a status reads rather than by its name.
 *
 * `OPEN` is `waiting` because it is a job somebody still owes, which is the one thing on a list
 * worth finding by scanning. `DELAYED` is `bad` and `CANCELED` is `neutral`, and that pairing is
 * the point: a slipped deadline is a live problem, while a task called off is over and deserves the
 * quietest ink on the page rather than a colour that pulls the eye to a closed row.
 */
export const TASK_LABEL: Record<
  TaskStatus,
  { text: string; tone: StatusTone }
> = {
  OPEN: { text: 'OPEN', tone: 'waiting' },
  IN_PROGRESS: { text: 'IN PROGRESS', tone: 'progress' },
  DELAYED: { text: 'DELAYED', tone: 'bad' },
  DONE: { text: 'DONE', tone: 'good' },
  CANCELED: { text: 'CANCELED', tone: 'neutral' },
}

/** Settled work: struck through, off the calendar, never chased by the bot. */
export const isSettled = (status: TaskStatus) => SETTLED_TASK.includes(status)

/**
 * Past its deadline and still owed.
 *
 * The same question the bot's sweep asks, minus the half-hour grace — the page
 * has no reason to wait, since nobody is being messaged. A task with no due
 * date is never overdue, which is why this is not a bare date comparison.
 */
export const isOverdue = (task: ApiTask, now: Date = new Date()) =>
  task.dueAt !== null &&
  !isSettled(task.status) &&
  new Date(task.dueAt).getTime() < now.getTime()

/**
 * The deadline as a person would say it, with the year only when it is not this
 * one — a list of this term's work reading "Nov 14, 2026" on every row spends
 * its width on the one part that never varies.
 */
export function dueLabel(iso: string, now: Date = new Date()): string {
  const due = new Date(iso)
  return due.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(due.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * Where a task lives, for the meta line: the project, or the fact that it has none.
 *
 * A task with no project is the club's own work rather than a build's, and saying so is not
 * decoration — on a page that mixes both, a row with no project chip would read as one whose
 * project failed to load.
 */
export const whereLabel = (task: ApiTask) =>
  task.project?.title ?? 'No project'

/**
 * The date-and-time pair a form sends, as one instant.
 *
 * End of day when no time is given, which is what the project board has always done — "due Friday"
 * means the end of Friday. The time box exists because the bot now chases a deadline half an hour
 * after it passes, and "Friday" is not a moment. Local both ways: the zone the person typing is
 * thinking in is the zone the club is in.
 */
export function dueInstant(date: string, time: string): string | null {
  if (!date) return null
  return new Date(`${date}T${time || '23:59'}`).toISOString()
}
