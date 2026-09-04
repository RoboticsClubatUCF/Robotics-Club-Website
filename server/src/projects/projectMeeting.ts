import { z } from 'zod'

/**
 * When a project meets, on the wire.
 *
 * Shared by the create route and the edit route rather than written twice, for
 * the reason `projectTerm.ts` gives about the same problem: the pairing rules
 * below are the sort of validation that gets copied once correctly and once
 * not, and the second copy is a project whose calendar quietly disagrees with
 * what its lead typed.
 *
 * Three shapes exist and only two are legal. A schedule is **days plus a range
 * plus optionally a place and a note**, or it is **nothing at all**. What it
 * may not be half of one: days with no times is a project that meets on
 * Tuesdays at no o'clock, and `expandMeetings` would skip it silently — a
 * project that reads as scheduled everywhere and appears on no calendar.
 *
 * **Creating a project requires one; editing one may clear it.** Those are
 * different rules on purpose. Nobody starts a build without knowing when it
 * meets, and asking at creation is the one moment somebody is already thinking
 * about it — but a project that has finished, or moved to Discord for a term,
 * should be able to say so rather than keep a stale Tuesday on the front page.
 */

/** A wall-clock time on a 24-hour clock. Not a moment — see `Project.meetingStartTime`. */
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/

const clock = z
  .string()
  .trim()
  .regex(CLOCK, 'Times are on a 24-hour clock, like "18:00".')

/**
 * Duplicates are a lead clicking Tuesday twice, not two meetings, and sorting
 * is what makes "Thursday and Tuesday" print as "Tuesdays and Thursdays".
 * Applied in the schema rather than at the call sites so the column is sorted
 * and unique by construction — every reader downstream gets to assume it.
 */
const weekdays = z
  .array(z.number().int().min(0).max(6))
  .min(1, 'Pick at least one day.')
  .max(7)
  .transform((days) => [...new Set(days)].sort((a, b) => a - b))

/**
 * The lead's own words about the meeting, and the one part of a schedule that
 * stays optional at creation.
 *
 * Longer than the location because it is a sentence or three rather than a room
 * number, and short enough that it stays a note: this is what somebody reads on
 * a calendar chip beside the time, not a second write-up. `description` is the
 * column for a write-up and it holds 20,000 characters.
 *
 * Empty is the same as absent — a textarea that has been typed into and cleared
 * sends `''`, and storing that would be a project whose calendar carries a blank
 * line. `.transform` rather than a `.refine` refusing it, because clearing the
 * note is a thing a lead means to do.
 */
const note = z
  .string()
  .trim()
  .max(400)
  .nullable()
  .optional()
  .transform((text) => (text === '' ? null : text))

/** The fields, required. What `POST /officer/projects` spreads. */
export const meetingFields = {
  meetingWeekdays: weekdays,
  meetingStartTime: clock,
  meetingEndTime: clock,
  meetingLocation: z.string().trim().max(160).nullable().optional(),
  // Optional even here, where the days and the times are not. A project cannot
  // exist without a time it meets; it can perfectly well exist with nothing
  // extra to say about it, and the site prints nothing rather than inventing a
  // sentence — see `Project.meetingDescription`.
  meetingDescription: note,
}

/**
 * The same fields, optional, for a PATCH.
 *
 * `meetingWeekdays` accepts an empty array here and nowhere else: that is how a
 * lead clears a schedule, and it is why this is not just `.partial()` over the
 * object above.
 */
export const meetingPatchFields = {
  meetingWeekdays: z.array(z.number().int().min(0).max(6)).max(7)
    .transform((days) => [...new Set(days)].sort((a, b) => a - b))
    .optional(),
  meetingStartTime: clock.nullable().optional(),
  meetingEndTime: clock.nullable().optional(),
  meetingLocation: z.string().trim().max(160).nullable().optional(),
  meetingDescription: note,
}

export interface MeetingShape {
  meetingWeekdays?: number[] | undefined
  meetingStartTime?: string | null | undefined
  meetingEndTime?: string | null | undefined
}

export const MEETING_ORDER = {
  message: 'A meeting has to end after it starts.',
  path: ['meetingEndTime'],
}

export const MEETING_WHOLE = {
  message: 'A schedule needs both the days and the times, or neither.',
  path: ['meetingWeekdays'],
}

/**
 * Ends after it starts.
 *
 * String comparison, not `Date`. These are wall-clock times zero-padded to the
 * same width, so `'18:00' < '22:00'` is exactly the comparison wanted, and
 * turning either into a `Date` to compare them is how the DST bugs this whole
 * design avoids get back in.
 *
 * A meeting that runs past midnight is refused rather than accommodated. The
 * expander can read one — it rolls the end forward a day — but a lead who types
 * 20:00 to 01:00 has far more often mistyped than genuinely booked the lab
 * overnight, and the club's building shuts at ten regardless.
 */
export function meetingRunsForward(value: MeetingShape): boolean {
  const { meetingStartTime: start, meetingEndTime: end } = value
  if (!start || !end) return true
  return start < end
}

/** Days and times stand or fall together — see the header. */
export function meetingIsWhole(value: MeetingShape): boolean {
  const days = value.meetingWeekdays
  const timed =
    Boolean(value.meetingStartTime) && Boolean(value.meetingEndTime)

  // Only speaks to what the body actually carried. A PATCH naming one field is
  // checked against the resulting row by the route, which knows the other half.
  if (days === undefined) return true
  return days.length > 0 ? timed : !timed
}
