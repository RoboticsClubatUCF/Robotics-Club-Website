import { describe, expect, it } from 'vitest'
import {
  formatMeetingRange,
  formatMeetingTime,
  formatWeekdays,
  hasSchedule,
  meetingLine,
} from './meetings'
import type { ApiManagedProject } from '../api/api'

/**
 * The sentence a project's schedule prints, everywhere it prints.
 *
 * All string maths and no `Date`, which is the rule this module exists to hold:
 * a wall-clock time is not a moment, and the moment it becomes one is the
 * moment a meeting starts moving with the reader's timezone instead of staying
 * put on campus.
 */

const project = (
  over: Partial<ApiManagedProject> = {},
): Pick<
  ApiManagedProject,
  | 'meetingWeekdays'
  | 'meetingStartTime'
  | 'meetingEndTime'
  | 'meetingLocation'
> => ({
  meetingWeekdays: [2, 4],
  meetingStartTime: '18:00',
  meetingEndTime: '22:00',
  meetingLocation: 'ENG2 Lab',
  ...over,
})

describe('formatMeetingTime', () => {
  it('reads a 24-hour clock as somebody would say it', () => {
    expect(formatMeetingTime('18:30')).toBe('6:30 PM')
    expect(formatMeetingTime('09:05')).toBe('9:05 AM')
  })

  it('gets the two hours everybody gets wrong', () => {
    // Not "0:00 AM", and not "12:00 PM".
    expect(formatMeetingTime('00:00')).toBe('12:00 AM')
    expect(formatMeetingTime('12:00')).toBe('12:00 PM')
  })
})

describe('formatMeetingRange', () => {
  it('says the meridiem once when both ends share it', () => {
    // "6:00 PM – 10:00 PM" reads as two facts; this reads as one span.
    expect(formatMeetingRange('18:00', '22:00')).toBe('6:00 – 10:00 PM')
  })

  it('says it twice when the meeting crosses noon', () => {
    expect(formatMeetingRange('11:00', '14:00')).toBe('11:00 AM – 2:00 PM')
  })
})

describe('formatWeekdays', () => {
  it('pluralises, because a weekly meeting is a habit not a date', () => {
    expect(formatWeekdays([4])).toBe('Thursdays')
    expect(formatWeekdays([2, 4])).toBe('Tuesdays and Thursdays')
    expect(formatWeekdays([1, 3, 5])).toBe(
      'Mondays, Wednesdays and Fridays',
    )
  })

  it('collapses the whole week rather than listing it', () => {
    expect(formatWeekdays([0, 1, 2, 3, 4, 5, 6])).toBe('every day')
  })

  it('says nothing for no days', () => {
    expect(formatWeekdays([])).toBe('')
  })
})

describe('meetingLine', () => {
  it('is the whole sentence, place included', () => {
    expect(meetingLine(project())).toBe(
      'Meets Tuesdays and Thursdays · 6:00 – 10:00 PM · ENG2 Lab',
    )
  })

  it('leaves the place out rather than inventing one', () => {
    expect(meetingLine(project({ meetingLocation: null }))).toBe(
      'Meets Tuesdays and Thursdays · 6:00 – 10:00 PM',
    )
  })

  /**
   * Half a schedule prints nothing at all.
   *
   * The server refuses to store one — days and times stand or fall together —
   * but rows written before that rule existed can still be half-filled, and
   * "Meets Tuesdays · undefined" is exactly the invented content the site's
   * copy rules forbid. The caller says nothing instead.
   */
  it('says nothing when the schedule is incomplete', () => {
    expect(meetingLine(project({ meetingWeekdays: [] }))).toBeNull()
    expect(meetingLine(project({ meetingStartTime: null }))).toBeNull()
    expect(meetingLine(project({ meetingEndTime: null }))).toBeNull()
  })
})

describe('hasSchedule', () => {
  it('needs all three, matching the server rule', () => {
    expect(hasSchedule(project())).toBe(true)
    expect(hasSchedule(project({ meetingWeekdays: [] }))).toBe(false)
    expect(hasSchedule(project({ meetingEndTime: null }))).toBe(false)
  })
})
