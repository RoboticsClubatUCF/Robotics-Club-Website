import type { ApiManagedProject, MeetingRepeat } from '../api/api'

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
  /**
   * The date sitting in the picker, not added yet. On a phone, picking a date and pressing
   * SAVE is the natural move and there's no Enter to add it first, so SAVE takes it too.
   */
  pendingDate: string
  /** '' for none, the way a date input says it. */
  startsOn: string
  startTime: string
  endTime: string
  location: string
  note: string
}

export const EMPTY_DRAFT: MeetingDraft = {
  repeat: 'WEEKLY',
  weekdays: [],
  interval: 1,
  monthWeeks: [],
  monthDays: [],
  dates: [],
  pendingDate: '',
  startsOn: '',
  startTime: '',
  endTime: '',
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
  | 'meetingLocation'
  | 'meetingDescription'
>

/** A saved schedule, ready to edit. No schedule opens as an empty weekly one. */
export const draftOf = (project: Saved): MeetingDraft => ({
  repeat: project.meetingRepeat ?? 'WEEKLY',
  weekdays: project.meetingWeekdays,
  interval: project.meetingInterval,
  monthWeeks: project.meetingMonthWeeks,
  monthDays: project.meetingMonthDays,
  dates: project.meetingDates,
  pendingDate: '',
  startsOn: project.meetingStartsOn ?? '',
  startTime: project.meetingStartTime ?? '',
  endTime: project.meetingEndTime ?? '',
  location: project.meetingLocation ?? '',
  note: project.meetingDescription ?? '',
})

/**
 * Sorted, with -1 ("the last") at the end where it reads, matching how the server stores
 * them so a toggled set compares equal to a saved one.
 */
export const tidyNumbers = (values: number[]) =>
  [...new Set(values)].sort((a, b) => (a === -1 ? 99 : a) - (b === -1 ? 99 : b))

/** The listed dates plus the one waiting in the picker, sorted and unique. */
export const datesOf = (draft: MeetingDraft) =>
  [...new Set([...draft.dates, draft.pendingDate].filter(Boolean))].sort()

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
      if (datesOf(draft).length === 0) return 'Add at least one date.'
      break
  }

  if (!draft.startTime || !draft.endTime) return 'Pick a start and an end time.'
  // Zero-padded wall-clock strings compare correctly as strings, and turning either into
  // a `Date` is how the DST bugs get in.
  if (draft.startTime >= draft.endTime) return 'The meeting has to end after it starts.'
  return null
}

/**
 * What the server is sent: the chosen pattern's fields, the rest emptied. Also the shape
 * `meetingPattern` reads, which is how a form describes a schedule before it's saved.
 */
export function draftBody(draft: MeetingDraft) {
  const weekly = draft.repeat === 'WEEKLY'
  const dated = draft.repeat === 'DATES'

  return {
    meetingRepeat: draft.repeat,
    meetingWeekdays:
      weekly || draft.repeat === 'MONTHLY_WEEKDAY' ? draft.weekdays : [],
    meetingInterval: weekly ? draft.interval : 1,
    meetingMonthWeeks: draft.repeat === 'MONTHLY_WEEKDAY' ? draft.monthWeeks : [],
    meetingMonthDays: draft.repeat === 'MONTHLY_DAY' ? draft.monthDays : [],
    meetingDates: dated ? datesOf(draft) : [],
    meetingStartsOn: dated || !draft.startsOn ? null : draft.startsOn,
    meetingStartTime: draft.startTime,
    meetingEndTime: draft.endTime,
    meetingLocation: draft.location.trim() || null,
    meetingDescription: draft.note.trim() || null,
  }
}
