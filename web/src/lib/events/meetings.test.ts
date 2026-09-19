import { describe, expect, it } from 'vitest'
import {
  formatMeetingRange,
  formatMeetingTime,
  formatWeekdays,
  hasSchedule,
  meetingLine,
  meetingNote,
  meetingPattern,
} from './meetings'
import {
  EMPTY_DRAFT,
  commonHours,
  draftBody,
  draftOf,
  draftProblem,
  hoursOf,
  meetingDays,
} from './meetingDraft'
import type { ApiManagedProject } from '../api/api'

/**
 * The sentence a project's schedule prints, everywhere it prints.
 *
 * All string maths and no `Date`, which is the rule this module exists to hold: a wall-clock time
 * is not a moment, and the moment it becomes one is the moment a meeting starts moving with the
 * reader's timezone instead of staying put on campus.
 */

const project = (
  over: Partial<ApiManagedProject> = {},
): Pick<
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
> => ({
  meetingRepeat: 'WEEKLY',
  meetingWeekdays: [2, 4],
  meetingInterval: 1,
  meetingMonthWeeks: [],
  meetingMonthDays: [],
  meetingDates: [],
  meetingStartsOn: null,
  meetingStartTime: '18:00',
  meetingEndTime: '22:00',
  meetingTimes: [],
  meetingLocation: 'ENG2 Lab',
  meetingDescription: null,
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
   * The server refuses to store one — days and times stand or fall together — but rows written
   * before that rule existed can still be half-filled, and "Meets Tuesdays · undefined" is exactly
   * the invented content the site's copy rules forbid. The caller says nothing instead.
   */
  it('says nothing when the schedule is incomplete', () => {
    expect(meetingLine(project({ meetingRepeat: null }))).toBeNull()
    expect(meetingLine(project({ meetingStartTime: null }))).toBeNull()
    expect(meetingLine(project({ meetingEndTime: null }))).toBeNull()
  })
})

describe('meetingNote', () => {
  it('is the lead note, and nothing when there is none', () => {
    const note = 'Bring a laptop.'
    expect(meetingNote(project({ meetingDescription: note }))).toBe(note)
    expect(meetingNote(project())).toBeNull()
    // A textarea that has been typed into and emptied is the same as one that
    // was never touched, whatever whitespace it left behind.
    expect(meetingNote(project({ meetingDescription: '   ' }))).toBeNull()
  })

  /**
   * A note under a project that does not meet is a sentence about a Tuesday
   * that no longer happens. The editor clears the two together; this is what
   * covers a row cleared straight in the database.
   */
  it('says nothing when there is no schedule to say it about', () => {
    expect(
      meetingNote(
        project({ meetingRepeat: null, meetingDescription: 'Bring a laptop.' }),
      ),
    ).toBeNull()
  })
})

describe('hasSchedule', () => {
  it('needs a pattern and both times, matching the server rule', () => {
    expect(hasSchedule(project())).toBe(true)
    expect(hasSchedule(project({ meetingRepeat: null }))).toBe(false)
    expect(hasSchedule(project({ meetingEndTime: null }))).toBe(false)
  })
})

/** Mid-September 2035, so "ahead" and "past" have something either side of them. */
const NOW = new Date(2035, 8, 15, 12, 0)

describe('meetingPattern', () => {
  it('says every other week the way people do', () => {
    expect(
      meetingPattern(project({ meetingWeekdays: [3], meetingInterval: 2 }), NOW),
    ).toBe('every other Wednesday')
    expect(
      meetingPattern(project({ meetingInterval: 2 }), NOW),
    ).toBe('every other Tuesday and Thursday')
    expect(
      meetingPattern(project({ meetingInterval: 3 }), NOW),
    ).toBe('every 3 weeks on Tuesdays and Thursdays')
  })

  it('names a first date only while it is still ahead', () => {
    const later = project({ meetingStartsOn: '2035-10-01' })
    expect(meetingPattern(later, NOW)).toMatch(/^Tuesdays and Thursdays from /)
    expect(meetingPattern(later, new Date(2035, 9, 5))).toBe(
      'Tuesdays and Thursdays',
    )
  })

  it('reads a monthly pattern back', () => {
    expect(
      meetingPattern(
        project({
          meetingRepeat: 'MONTHLY_WEEKDAY',
          meetingWeekdays: [6],
          meetingMonthWeeks: [1, 3],
        }),
        NOW,
      ),
    ).toBe('the first and third Saturday of the month')
    expect(
      meetingPattern(
        project({
          meetingRepeat: 'MONTHLY_WEEKDAY',
          meetingWeekdays: [5],
          meetingMonthWeeks: [-1],
        }),
        NOW,
      ),
    ).toBe('the last Friday of the month')
    expect(
      meetingPattern(
        project({ meetingRepeat: 'MONTHLY_DAY', meetingMonthDays: [1, 12, -1] }),
        NOW,
      ),
    ).toBe('on the 1st, 12th and last day of the month')
  })

  /**
   * A list names the dates still ahead, a few of them, since a past date is no use to anybody
   * reading a dashboard card. With none left there's nothing to say, and the line goes.
   */
  it('names the next few dates of a list, and nothing once they have passed', () => {
    const dated = (dates: string[]) =>
      project({ meetingRepeat: 'DATES', meetingWeekdays: [], meetingDates: dates })

    expect(
      meetingPattern(
        dated(['2035-09-01', '2035-09-20', '2035-10-04', '2035-10-18', '2035-11-01']),
        NOW,
      ),
    ).toMatch(/ and 1 more date$/)
    expect(meetingPattern(dated(['2035-09-01']), NOW)).toBeNull()
    expect(meetingLine(dated(['2035-09-01']), NOW)).toBeNull()
  })
})

describe('a pattern not filled in yet', () => {
  /** The form reads its draft through here, so half a pattern is a normal state. */
  it('says nothing rather than half a sentence', () => {
    expect(meetingPattern(project({ meetingWeekdays: [], meetingInterval: 2 }), NOW)).toBeNull()
    expect(
      meetingPattern(project({ meetingRepeat: 'MONTHLY_WEEKDAY', meetingMonthWeeks: [] }), NOW),
    ).toBeNull()
    expect(
      meetingPattern(project({ meetingRepeat: 'MONTHLY_DAY', meetingMonthDays: [] }), NOW),
    ).toBeNull()
  })
})

describe('the schedule form', () => {
  it('opens an unscheduled project as an empty weekly one', () => {
    expect(draftOf(project({ meetingRepeat: null, meetingWeekdays: [] }))).toMatchObject({
      repeat: 'WEEKLY',
      weekdays: [],
    })
  })

  it('asks for the part each pattern needs before anything else', () => {
    const timed = { ...EMPTY_DRAFT, startTime: '18:00', endTime: '20:00' }

    expect(draftProblem(timed)).toBe('Pick at least one day.')
    expect(draftProblem({ ...timed, weekdays: [3], interval: 2 })).toMatch(
      /first meeting/,
    )
    expect(draftProblem({ ...timed, repeat: 'MONTHLY_WEEKDAY', weekdays: [6] })).toBe(
      'Pick which week of the month.',
    )
    expect(draftProblem({ ...timed, repeat: 'DATES' })).toBe('Pick at least one date.')
    expect(
      draftProblem({ ...timed, repeat: 'DATES', dates: ['2035-10-01'], endTime: '17:00' }),
    ).toBe('The meeting has to end after it starts.')
    expect(draftProblem({ ...timed, weekdays: [2] })).toBeNull()
  })

  /**
   * The draft keeps every pattern's fields while a lead flips between them, so trying monthly
   * doesn't lose the ticked days. Only the chosen pattern's reach the server.
   */
  it('sends only the chosen pattern', () => {
    const body = draftBody({
      ...EMPTY_DRAFT,
      repeat: 'DATES',
      weekdays: [2, 4],
      interval: 2,
      startsOn: '2035-09-02',
      dates: ['2035-10-01'],
      startTime: '18:00',
      endTime: '20:00',
      location: '  ',
    })

    expect(body).toMatchObject({
      meetingRepeat: 'DATES',
      meetingWeekdays: [],
      meetingInterval: 1,
      meetingStartsOn: null,
      meetingDates: ['2035-10-01'],
      meetingLocation: null,
    })
  })
})

/** Thursdays at seven till nine where Tuesdays keep six till ten. */
describe('hours that differ by day', () => {
  const lateThursdays = { day: '4', startTime: '19:00', endTime: '21:00' }

  it('prints each day with its hours, days that share them together', () => {
    expect(meetingLine(project({ meetingTimes: [lateThursdays] }), NOW)).toBe(
      'Meets Tuesdays and Thursdays · Tue 6:00 – 10:00 PM; Thu 7:00 – 9:00 PM · ENG2 Lab',
    )
    expect(
      meetingLine(
        project({ meetingWeekdays: [1, 2, 4], meetingTimes: [lateThursdays] }),
        NOW,
      ),
    ).toBe(
      'Meets Mondays, Tuesdays and Thursdays · Mon and Tue 6:00 – 10:00 PM; Thu 7:00 – 9:00 PM · ENG2 Lab',
    )
  })

  it('names the day of the month the hours belong to', () => {
    expect(
      meetingLine(
        project({
          meetingRepeat: 'MONTHLY_DAY',
          meetingWeekdays: [],
          meetingMonthDays: [1, -1],
          meetingTimes: [{ day: '-1', startTime: '09:00', endTime: '11:00' }],
          meetingLocation: null,
        }),
        NOW,
      ),
    ).toBe(
      'Meets on the 1st and last day of the month · 1st 6:00 – 10:00 PM; last day 9:00 – 11:00 AM',
    )
  })

  /** A list of dates puts each date's hours beside it, for the ones still ahead. */
  it('puts a listed date beside its own hours', () => {
    const dated = project({
      meetingRepeat: 'DATES',
      meetingWeekdays: [],
      meetingDates: ['2035-09-01', '2035-09-20', '2035-10-04', '2035-10-18', '2035-11-01'],
      meetingTimes: [{ day: '2035-10-04', startTime: '10:00', endTime: '14:00' }],
      meetingLocation: null,
    })

    expect(meetingLine(dated, NOW)).toBe(
      'Meets Sep 20 6:00 – 10:00 PM, Oct 4 10:00 AM – 2:00 PM, Oct 18 6:00 – 10:00 PM and 1 more date',
    )
    // Hours that only differed on a date now past leave one set to print.
    expect(
      meetingLine(
        { ...dated, meetingTimes: [{ day: '2035-09-01', startTime: '10:00', endTime: '14:00' }] },
        NOW,
      ),
    ).toMatch(/ · 6:00 – 10:00 PM$/)
  })
})

describe('the hours in the schedule form', () => {
  const weekly = draftOf(
    project({ meetingTimes: [{ day: '4', startTime: '19:00', endTime: '21:00' }] }),
  )

  it('opens saved hours as varying, each under its own day', () => {
    expect(weekly).toMatchObject({
      varies: true,
      startTime: '18:00',
      dayHours: { 'weekday:4': { startTime: '19:00', endTime: '21:00' } },
    })
    expect(meetingDays(weekly).map((day) => day.label)).toEqual(['Tuesday', 'Thursday'])
    expect(hoursOf(weekly, 'weekday:2')).toEqual({ startTime: '18:00', endTime: '22:00' })
  })

  /**
   * The hours most days keep are sent as the usual ones, so the fewest days need a row of
   * their own, and a day back on those hours needs none.
   */
  it('sends the common hours as the usual ones and only the days that differ', () => {
    const body = draftBody({
      ...weekly,
      weekdays: [1, 2, 4],
      dayHours: {
        'weekday:1': { startTime: '19:00', endTime: '21:00' },
        'weekday:2': { startTime: '18:00', endTime: '22:00' },
        'weekday:4': { startTime: '19:00', endTime: '21:00' },
      },
    })

    expect(body).toMatchObject({
      meetingStartTime: '19:00',
      meetingEndTime: '21:00',
      meetingTimes: [{ day: '2', startTime: '18:00', endTime: '22:00' }],
    })
    expect(draftBody({ ...weekly, varies: false })).toMatchObject({
      meetingStartTime: '18:00',
      meetingTimes: [],
    })
  })

  /** Tuesday's hours are day "2", and they mustn't turn up as the 2nd of the month's. */
  it('keeps one kind of day from reading another kind’s hours', () => {
    const monthly = { ...weekly, repeat: 'MONTHLY_DAY' as const, monthDays: [4] }

    expect(hoursOf(monthly, 'monthDay:4')).toEqual({ startTime: '18:00', endTime: '22:00' })
    expect(draftBody(monthly).meetingTimes).toEqual([])
  })

  it('names the day whose hours are wrong', () => {
    expect(
      draftProblem({
        ...weekly,
        dayHours: { 'weekday:4': { startTime: '21:00', endTime: '19:00' } },
      }),
    ).toBe('Thursday: the meeting has to end after it starts.')
    expect(
      draftProblem({
        ...weekly,
        startTime: '',
        endTime: '',
        dayHours: { 'weekday:4': { startTime: '19:00', endTime: '' } },
      }),
    ).toBe('Tuesday: pick a start and an end time.')
  })

  /** On the create desk nothing is shared yet, and a day would otherwise open blank. */
  it('starts a day with no shared hours on another day’s', () => {
    const fresh = {
      ...weekly,
      startTime: '',
      endTime: '',
      dayHours: { 'weekday:4': { startTime: '19:00', endTime: '21:00' } },
    }

    expect(hoursOf(fresh, 'weekday:2')).toEqual({ startTime: '19:00', endTime: '21:00' })
    expect(draftProblem(fresh)).toBeNull()
  })

  it('goes back to one set of hours on the ones most days had', () => {
    const late = { startTime: '19:00', endTime: '21:00' }

    expect(
      commonHours({
        ...weekly,
        weekdays: [2, 4, 6],
        dayHours: { 'weekday:4': late, 'weekday:6': late },
      }),
    ).toEqual(late)
  })
})
