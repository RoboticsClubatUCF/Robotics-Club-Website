import { z } from 'zod'
import { MeetingRepeat, type Season } from '../generated/prisma/enums.js'
import { getTerm } from '../membership/semester.js'
import { campusDate, dateProblem } from './meetings.js'

/**
 * When a project meets, on the wire and on the row.
 *
 * Shared by the create route and the edit route rather than written twice: these are
 * the rules that get copied once correctly and once not, and the second copy is a
 * project whose calendar quietly disagrees with what its lead typed.
 *
 * A schedule is a pattern plus a start and end time, or it's nothing. Each pattern needs
 * its own part filled in (days for weekly, a date for a list of dates), and the columns
 * a pattern doesn't read are emptied on the way in. Half a schedule is refused, because
 * it would read as scheduled and appear on no calendar.
 *
 * Creating a project requires one; editing one may clear it. A project that has finished
 * should be able to say so rather than keep a stale Tuesday on the front page.
 */

/** A wall-clock time on a 24-hour clock. Not a moment — see `Project.meetingStartTime`. */
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/

const clock = z
  .string()
  .trim()
  .regex(CLOCK, 'Times are on a 24-hour clock, like "18:00".')

/** "2026-09-23", and a date that exists: the shape alone takes the 31st of June. */
export function isCivilDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const at = new Date(Date.UTC(year, month - 1, day))
  return (
    at.getUTCFullYear() === year &&
    at.getUTCMonth() === month - 1 &&
    at.getUTCDate() === day
  )
}

const civilDate = z
  .string()
  .trim()
  .refine(isCivilDate, 'Dates look like "2026-09-23".')

/**
 * Sorted and unique, with -1 ("the last") at the end, where it reads. Applied in the
 * schema so every column is tidy by construction and every reader can assume it.
 */
const tidy = (values: number[]) =>
  [...new Set(values)].sort((a, b) => (a === -1 ? 99 : a) - (b === -1 ? 99 : b))

const weekdays = z.array(z.number().int().min(0).max(6)).max(7).transform(tidy)

const monthWeeks = z
  .array(
    z
      .number()
      .int()
      .refine((n) => n === -1 || (n >= 1 && n <= 4), {
        message: 'Weeks of the month are 1 to 4, or -1 for the last.',
      }),
  )
  .max(5)
  .transform(tidy)

const monthDays = z
  .array(
    z
      .number()
      .int()
      .refine((n) => n === -1 || (n >= 1 && n <= 28), {
        message: 'Days of the month are 1 to 28, or -1 for the last.',
      }),
  )
  .max(29)
  .transform(tidy)

/** A term of every day is about 110; nobody picks more than this by hand. */
export const MAX_MEETING_DATES = 120

const dates = z
  .array(civilDate)
  .max(MAX_MEETING_DATES, `A schedule holds up to ${String(MAX_MEETING_DATES)} dates.`)
  .transform((list) => [...new Set(list)].sort())

/** Every week to every fourth. Past that it's a monthly meeting. */
const interval = z.number().int().min(1).max(4)

/** Empty is the same as absent: a field typed into and cleared sends `''`. */
const blankIsNull = (text: string | null | undefined) =>
  text === '' ? null : text

/**
 * The lead's own words about the meeting. Longer than the location because it's a
 * sentence or three, short enough that it stays a note on a calendar chip.
 */
const note = z.string().trim().max(400).nullable().optional().transform(blankIsNull)

const place = z.string().trim().max(160).nullable().optional().transform(blankIsNull)

/**
 * The fields, for `POST /officer/projects`. The whole-schedule rules are checked by
 * `scheduleProblem` in the handler.
 *
 * `meetingRepeat` defaults to weekly, which is what every client meant before there
 * was a choice.
 */
export const meetingFields = {
  meetingRepeat: z.enum(MeetingRepeat).default(MeetingRepeat.WEEKLY),
  meetingWeekdays: weekdays.default([]),
  meetingInterval: interval.default(1),
  meetingMonthWeeks: monthWeeks.default([]),
  meetingMonthDays: monthDays.default([]),
  meetingDates: dates.default([]),
  meetingStartsOn: civilDate.nullable().optional(),
  meetingStartTime: clock,
  meetingEndTime: clock,
  meetingLocation: place,
  meetingDescription: note,
}

/** The same fields, all optional, for a PATCH. `meetingRepeat: null` clears the schedule. */
export const meetingPatchFields = {
  meetingRepeat: z.enum(MeetingRepeat).nullable().optional(),
  meetingWeekdays: weekdays.optional(),
  meetingInterval: interval.optional(),
  meetingMonthWeeks: monthWeeks.optional(),
  meetingMonthDays: monthDays.optional(),
  meetingDates: dates.optional(),
  meetingStartsOn: civilDate.nullable().optional(),
  meetingStartTime: clock.nullable().optional(),
  meetingEndTime: clock.nullable().optional(),
  meetingLocation: place,
  meetingDescription: note,
}

/** A project's schedule columns, as the row holds them. */
export interface MeetingSchedule {
  meetingRepeat: MeetingRepeat | null
  meetingWeekdays: number[]
  meetingInterval: number
  meetingMonthWeeks: number[]
  meetingMonthDays: number[]
  meetingDates: string[]
  meetingStartsOn: string | null
  meetingStartTime: string | null
  meetingEndTime: string | null
  meetingLocation: string | null
  meetingDescription: string | null
}

const SCHEDULE_KEYS = [
  'meetingRepeat',
  'meetingWeekdays',
  'meetingInterval',
  'meetingMonthWeeks',
  'meetingMonthDays',
  'meetingDates',
  'meetingStartsOn',
  'meetingStartTime',
  'meetingEndTime',
  'meetingLocation',
  'meetingDescription',
] as const

export type SchedulePatch = { [K in keyof MeetingSchedule]?: MeetingSchedule[K] | undefined }

export const NO_SCHEDULE: MeetingSchedule = {
  meetingRepeat: null,
  meetingWeekdays: [],
  meetingInterval: 1,
  meetingMonthWeeks: [],
  meetingMonthDays: [],
  meetingDates: [],
  meetingStartsOn: null,
  meetingStartTime: null,
  meetingEndTime: null,
  meetingLocation: null,
  meetingDescription: null,
}

/** Whether a PATCH says anything about the schedule at all. */
export const touchesSchedule = (patch: SchedulePatch) =>
  SCHEDULE_KEYS.some((key) => patch[key] !== undefined)

/** The schedule columns off a whole row. */
export const scheduleOf = (row: MeetingSchedule): MeetingSchedule => ({
  meetingRepeat: row.meetingRepeat,
  meetingWeekdays: row.meetingWeekdays,
  meetingInterval: row.meetingInterval,
  meetingMonthWeeks: row.meetingMonthWeeks,
  meetingMonthDays: row.meetingMonthDays,
  meetingDates: row.meetingDates,
  meetingStartsOn: row.meetingStartsOn,
  meetingStartTime: row.meetingStartTime,
  meetingEndTime: row.meetingEndTime,
  meetingLocation: row.meetingLocation,
  meetingDescription: row.meetingDescription,
})

/**
 * Empties whatever the pattern doesn't read, so the row never carries a Tuesday a
 * monthly schedule ignores. No pattern empties everything, the note and the place
 * included: a project that has stopped meeting shouldn't keep a note about how it used to.
 */
export function tidySchedule(schedule: MeetingSchedule): MeetingSchedule {
  switch (schedule.meetingRepeat) {
    case null:
      return NO_SCHEDULE
    case MeetingRepeat.WEEKLY:
      return { ...schedule, meetingMonthWeeks: [], meetingMonthDays: [], meetingDates: [] }
    case MeetingRepeat.MONTHLY_WEEKDAY:
      return { ...schedule, meetingInterval: 1, meetingMonthDays: [], meetingDates: [] }
    case MeetingRepeat.MONTHLY_DAY:
      return {
        ...schedule,
        meetingWeekdays: [],
        meetingInterval: 1,
        meetingMonthWeeks: [],
        meetingDates: [],
      }
    case MeetingRepeat.DATES:
      return {
        ...schedule,
        meetingWeekdays: [],
        meetingInterval: 1,
        meetingMonthWeeks: [],
        meetingMonthDays: [],
        meetingStartsOn: null,
      }
  }
}

/**
 * The row's schedule with a PATCH laid over it, tidied.
 *
 * The rules hold on the result, whichever fields the body carried: a PATCH naming only
 * `meetingStartTime: null` would otherwise leave days with no times.
 *
 * A body with days and no pattern is a page loaded before patterns existed, and it
 * means weekly, the only thing there was. Empty days was how it cleared a schedule.
 */
export function mergeSchedule(
  row: MeetingSchedule,
  patch: SchedulePatch,
): MeetingSchedule {
  const merged = { ...scheduleOf(row) }
  for (const key of SCHEDULE_KEYS) {
    if (patch[key] !== undefined) Object.assign(merged, { [key]: patch[key] })
  }

  if (patch.meetingRepeat === undefined && patch.meetingWeekdays !== undefined) {
    merged.meetingRepeat =
      patch.meetingWeekdays.length > 0 ? MeetingRepeat.WEEKLY : null
    merged.meetingInterval = 1
  }

  return tidySchedule(merged)
}

/**
 * What's missing from a schedule, as the sentence the form shows, or null.
 *
 * String comparison for the times, not `Date`: zero-padded wall-clock strings compare
 * exactly as wanted, and turning either into a `Date` is how DST bugs get back in. A
 * meeting past midnight is refused; far more often it's a typo, and the building shuts
 * at ten regardless.
 */
export function scheduleProblem(schedule: MeetingSchedule): string | null {
  if (schedule.meetingRepeat === null) return null

  const { meetingStartTime: start, meetingEndTime: end } = schedule
  if (!start || !end) return 'A schedule needs a start and an end time.'
  if (start >= end) return 'A meeting has to end after it starts.'

  switch (schedule.meetingRepeat) {
    case MeetingRepeat.WEEKLY:
      if (schedule.meetingWeekdays.length === 0) return 'Pick at least one day.'
      if (schedule.meetingInterval > 1 && !schedule.meetingStartsOn) {
        return 'Pick the date of the first meeting, so the weeks have somewhere to count from.'
      }
      return null
    case MeetingRepeat.MONTHLY_WEEKDAY:
      if (schedule.meetingMonthWeeks.length === 0) {
        return 'Pick which week of the month.'
      }
      if (schedule.meetingWeekdays.length === 0) return 'Pick at least one day.'
      return null
    case MeetingRepeat.MONTHLY_DAY:
      return schedule.meetingMonthDays.length === 0
        ? 'Pick at least one day of the month.'
        : null
    case MeetingRepeat.DATES:
      return schedule.meetingDates.length === 0 ? 'Add at least one date.' : null
  }
}

/** "8 December", or "8 December 2025" where the year may be the mistake. */
const spoken = (date: string, withYear = false) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  })

/**
 * The problems only the project's term can see, or null.
 *
 * A listed date outside the term or inside finals week would never be drawn, so it's
 * refused here with the reason rather than silently missing from every calendar.
 */
export async function scheduleTermProblem(
  schedule: MeetingSchedule,
  term: { termYear: number; termSeason: Season },
): Promise<string | null> {
  const { meetingStartTime: start, meetingEndTime: end } = schedule
  if (schedule.meetingRepeat === null || !start || !end) return null

  const found = await getTerm(term.termYear, term.termSeason)

  if (schedule.meetingStartsOn && schedule.meetingStartsOn > campusDate(found.endsAt)) {
    return `The first meeting is after the term ends on ${spoken(campusDate(found.endsAt))}.`
  }

  for (const date of schedule.meetingDates) {
    const problem = dateProblem(found, date, start, end)
    if (problem === 'outside') {
      return `${spoken(date, true)} isn't in this project's semester.`
    }
    if (problem === 'finals') {
      return `${spoken(date)} is in finals week, when projects don't meet.`
    }
  }

  return null
}
