import type { ApiManagedProject, ApiMeetingTime, MeetingRepeat } from '../api/api'
import { WEEKDAY_NAMES, formatCivilDate, ordinal } from './meetings'

/**
 * The meeting schedule as a form holds it, on the create desk and the manage page.
 *
 * Every pattern's fields are kept while a lead flips between patterns, so trying MONTHLY and
 * going back to WEEKLY doesn't lose the days they ticked. Only the chosen pattern's fields are
 * sent; the server empties the rest anyway (`server/src/projects/projectMeeting.ts`).
 */
export type MeetingDraft = {
  repeat: MeetingRepeat
  weekdays: number[]
  interval: number
  monthWeeks: number[]
  monthDays: number[]
  dates: string[]
  /** '' for none, the way a date input says it. */
  startsOn: string
  /** Every day's hours, or, while they vary, the ones a newly added day starts on. */
  startTime: string
  endTime: string
  /** Whether each day has its own hours. */
  varies: boolean
  /**
   * What a lead typed for each day, keyed by `MeetingDay.key`. Emptied by a switch back to one
   * set of hours, so DIFFERENT always starts from the hours on screen. Only the hours that
   * differ are sent.
   */
  dayHours: Record<string, Hours>
  location: string
  note: string
}

export type Hours = { startTime: string; endTime: string }

export const EMPTY_DRAFT: MeetingDraft = {
  repeat: 'WEEKLY',
  weekdays: [],
  interval: 1,
  monthWeeks: [],
  monthDays: [],
  dates: [],
  startsOn: '',
  startTime: '',
  endTime: '',
  varies: false,
  dayHours: {},
  location: '',
  note: '',
}

type Saved = Pick<
  ApiManagedProject,
  | 'meetingRepeat'
  | 'meetingWeekdays'
  | 'meetingInterval'
  | 'meetingMonthWeeks'
  | 'meetingMonthDays'
  | 'meetingDates'
  | 'meetingStartsOn'
  | 'meetingStartTime'
  | 'meetingEndTime'
  | 'meetingTimes'
  | 'meetingLocation'
  | 'meetingDescription'
>

/**
 * One of the pattern's days, as the hours list shows it. `day` is how the server spells it
 * and `key` adds the kind, so Tuesday's hours ("2") never turn up as the 2nd of the month's.
 * `spoken` is the label in full, for a screen reader: "Saturday, September 26" for a date.
 */
export type MeetingDay = { key: string; day: string; label: string; spoken: string }

const kindOf = (repeat: MeetingRepeat) =>
  repeat === 'MONTHLY_DAY' ? 'monthDay' : repeat === 'DATES' ? 'date' : 'weekday'

/** The days the chosen pattern meets on, in the order it reads. */
export function meetingDays(
  draft: Pick<MeetingDraft, 'repeat' | 'weekdays' | 'monthDays' | 'dates'>,
): MeetingDay[] {
  switch (kindOf(draft.repeat)) {
    case 'weekday':
      return draft.weekdays.map((day) => {
        const label = WEEKDAY_NAMES[day] ?? String(day)
        return { key: `weekday:${String(day)}`, day: String(day), label, spoken: label }
      })
    case 'monthDay':
      return draft.monthDays.map((day) => {
        const label = day === -1 ? 'The last day' : `The ${ordinal(day)}`
        return { key: `monthDay:${String(day)}`, day: String(day), label, spoken: label }
      })
    case 'date':
      return draft.dates.map((date) => ({
        key: `date:${date}`,
        day: date,
        label: formatCivilDate(date, { weekday: 'short', month: 'short', day: 'numeric' }),
        spoken: formatCivilDate(date, { weekday: 'long', month: 'long', day: 'numeric' }),
      }))
  }
}

const whole = (hours: Hours | undefined): hours is Hours =>
  Boolean(hours?.startTime && hours.endTime)

/**
 * The hours a day meets on: its own while the hours vary and it has some, else every day's.
 * With no shared hours yet, as on the create desk, a day starts on the first whole set another
 * day has, rather than blank.
 */
export function hoursOf(draft: MeetingDraft, key: string): Hours {
  const shared = { startTime: draft.startTime, endTime: draft.endTime }
  if (!draft.varies) return shared

  const own = draft.dayHours[key]
  if (own) return own
  if (whole(shared)) return shared

  const typed = meetingDays(draft)
    .map((day) => draft.dayHours[day.key])
    .find(whole)
  return typed ?? shared
}

/**
 * The hours most days keep. Sent as the usual hours, so the fewest days need their own, and
 * what one set of hours starts as when a lead switches back. A tie keeps the usual hours if
 * they're in it, so the stored ones don't swap on a two-day schedule, and the first day's if not.
 */
export function commonHours(draft: MeetingDraft): Hours {
  const idOf = (hours: Hours) => `${hours.startTime}-${hours.endTime}`
  const usual = idOf({ startTime: draft.startTime, endTime: draft.endTime })

  const counts = new Map<string, { hours: Hours; count: number }>()
  for (const { key } of meetingDays(draft)) {
    const hours = hoursOf(draft, key)
    if (!hours.startTime || !hours.endTime) continue
    const id = idOf(hours)
    counts.set(id, { hours, count: (counts.get(id)?.count ?? 0) + 1 })
  }

  let common: { hours: Hours; count: number } | null = null
  for (const [id, entry] of counts) {
    if (
      !common ||
      entry.count > common.count ||
      (entry.count === common.count && id === usual)
    ) {
      common = entry
    }
  }
  return common?.hours ?? { startTime: draft.startTime, endTime: draft.endTime }
}

/** A saved schedule, ready to edit. No schedule opens as an empty weekly one. */
export const draftOf = (project: Saved): MeetingDraft => ({
  repeat: project.meetingRepeat ?? 'WEEKLY',
  weekdays: project.meetingWeekdays,
  interval: project.meetingInterval,
  monthWeeks: project.meetingMonthWeeks,
  monthDays: project.meetingMonthDays,
  dates: project.meetingDates,
  startsOn: project.meetingStartsOn ?? '',
  startTime: project.meetingStartTime ?? '',
  endTime: project.meetingEndTime ?? '',
  varies: project.meetingTimes.length > 0,
  dayHours: Object.fromEntries(
    project.meetingTimes.map(({ day, startTime, endTime }) => [
      `${kindOf(project.meetingRepeat ?? 'WEEKLY')}:${day}`,
      { startTime, endTime },
    ]),
  ),
  location: project.meetingLocation ?? '',
  note: project.meetingDescription ?? '',
})

/**
 * Sorted, with -1 ("the last") at the end where it reads, matching how the server stores
 * them so a toggled set compares equal to a saved one.
 */
export const tidyNumbers = (values: number[]) =>
  [...new Set(values)].sort((a, b) => (a === -1 ? 99 : a) - (b === -1 ? 99 : b))

/** Adds a value to a set held as an array, or takes it out. */
export const toggled = (values: number[], value: number) =>
  values.includes(value)
    ? values.filter((each) => each !== value)
    : tidyNumbers([...values, value])

/**
 * The server's refusals, asked before the round trip: these are the mistakes somebody
 * actually makes, and being told by a 400 is a wait for nothing. The server checks the
 * same things regardless, plus the ones only the term can answer.
 */
export function draftProblem(draft: MeetingDraft): string | null {
  switch (draft.repeat) {
    case 'WEEKLY':
      if (draft.weekdays.length === 0) return 'Pick at least one day.'
      if (draft.interval > 1 && !draft.startsOn) {
        return 'Pick the date of the first meeting, so the weeks have somewhere to count from.'
      }
      break
    case 'MONTHLY_WEEKDAY':
      if (draft.monthWeeks.length === 0) return 'Pick which week of the month.'
      if (draft.weekdays.length === 0) return 'Pick at least one day.'
      break
    case 'MONTHLY_DAY':
      if (draft.monthDays.length === 0) return 'Pick at least one day of the month.'
      break
    case 'DATES':
      if (draft.dates.length === 0) return 'Pick at least one date.'
      break
  }

  return hoursProblem(draft)
}

/**
 * What's wrong with the hours alone, or null. The form reads the hours back in words only
 * once this is null, so a half-typed time never prints as midnight.
 *
 * Zero-padded wall-clock strings compare correctly as strings, and turning either into a
 * `Date` is how the DST bugs get in.
 */
export function hoursProblem(draft: MeetingDraft): string | null {
  if (!draft.varies) {
    if (!draft.startTime || !draft.endTime) return 'Pick a start and an end time.'
    if (draft.startTime >= draft.endTime) return 'The meeting has to end after it starts.'
    return null
  }

  for (const { key, label } of meetingDays(draft)) {
    const { startTime, endTime } = hoursOf(draft, key)
    if (!startTime || !endTime) return `${label}: pick a start and an end time.`
    if (startTime >= endTime) return `${label}: the meeting has to end after it starts.`
  }
  return null
}

/**
 * What the server is sent: the chosen pattern's fields, the rest emptied. Also the shape
 * `meetingPattern` reads, which is how a form describes a schedule before it's saved.
 */
export function draftBody(draft: MeetingDraft) {
  const weekly = draft.repeat === 'WEEKLY'
  const dated = draft.repeat === 'DATES'
  const usual = draft.varies
    ? commonHours(draft)
    : { startTime: draft.startTime, endTime: draft.endTime }
  const meetingTimes: ApiMeetingTime[] = draft.varies
    ? meetingDays(draft).flatMap(({ key, day }) => {
        const { startTime, endTime } = hoursOf(draft, key)
        return startTime === usual.startTime && endTime === usual.endTime
          ? []
          : [{ day, startTime, endTime }]
      })
    : []

  return {
    meetingRepeat: draft.repeat,
    meetingWeekdays:
      weekly || draft.repeat === 'MONTHLY_WEEKDAY' ? draft.weekdays : [],
    meetingInterval: weekly ? draft.interval : 1,
    meetingMonthWeeks: draft.repeat === 'MONTHLY_WEEKDAY' ? draft.monthWeeks : [],
    meetingMonthDays: draft.repeat === 'MONTHLY_DAY' ? draft.monthDays : [],
    meetingDates: dated ? draft.dates : [],
    meetingStartsOn: dated || !draft.startsOn ? null : draft.startsOn,
    meetingStartTime: usual.startTime,
    meetingEndTime: usual.endTime,
    meetingTimes,
    meetingLocation: draft.location.trim() || null,
    meetingDescription: draft.note.trim() || null,
  }
}
