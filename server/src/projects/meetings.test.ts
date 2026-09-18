import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_WINDOW_DAYS, expandMeetings, meetingOn } from './meetings.js'
import type { MeetingProject } from './meetings.js'
import { clearCalendarCache } from '../membership/semester.js'
import { MeetingRepeat, Season } from '../generated/prisma/enums.js'

/**
 * Turning "Tuesdays and Thursdays, six till ten" into squares on a calendar.
 *
 * This is the arithmetic that used to live in the browser, where it could see neither the end of a
 * term nor finals week and therefore respected neither. Both bounds are the point of the move, so
 * both are asserted here — and so is the thing that made a wall-clock schedule worth keeping out
 * of timestamps: a meeting is at six in Orlando in July and at six in Orlando in December, and the
 * instant that means moves by an hour in between.
 *
 * `fetch` is stubbed rather than `getTerm` mocked, the way `semester.test.ts` does it: the feed
 * parsing that decides when finals is would otherwise not be exercised at all.
 *
 * Fixtures are pinned to 2035, far enough out that no real row is anywhere near them.
 */

/** A term as UCF publishes one. `Classes End` is what finals hangs off. */
function feed(
  classesBegin: string,
  classesEnd: string,
  housingCloses: string,
  session = '1',
) {
  return {
    terms: [
      {
        events: [
          { summary: 'Classes Begin', dtstart: classesBegin, eventSession: session },
          { summary: 'Classes End', dtstart: classesEnd, eventSession: session },
          {
            summary: 'On-Campus Housing Closes',
            dtstart: housingCloses,
            eventSession: session,
          },
        ],
      },
    ],
  }
}

/**
 * Fall 2035: classes 27 August to 5 December, everyone out by the 12th.
 *
 * So finals runs 6 to 12 December — the day after classes end, through the end
 * of the term — and the fortnight either side of it is what most of the
 * assertions below are about.
 */
const TERMS: Record<string, unknown> = {
  '2035/fall': feed(
    '2035-08-27T08:00:00',
    '2035-12-05T08:00:00',
    '2035-12-12T09:00:00',
  ),
  '2035/spring': feed(
    '2035-01-08T08:00:00',
    '2035-04-27T08:00:00',
    '2035-05-04T09:00:00',
  ),
  '2035/summer': feed(
    '2035-05-14T08:00:00',
    '2035-07-27T08:00:00',
    '2035-08-03T09:00:00',
    'c',
  ),
}

beforeEach(() => {
  clearCalendarCache()

  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request) => {
      const url = String(input)
      const match = Object.keys(TERMS).find((key) => url.endsWith(key))

      if (!match) {
        return Promise.resolve(new Response('not found', { status: 404 }))
      }

      return Promise.resolve(
        new Response(JSON.stringify(TERMS[match]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearCalendarCache()
})

/** Tuesdays and Thursdays, six till ten. The club's own example. */
const rover = (over: Partial<MeetingProject> = {}): MeetingProject => ({
  id: 'p-meetings-1',
  slug: 'test-meetings-rover',
  title: 'Rover',
  termYear: 2035,
  termSeason: Season.FALL,
  meetingRepeat: MeetingRepeat.WEEKLY,
  meetingWeekdays: [2, 4],
  meetingInterval: 1,
  meetingMonthWeeks: [],
  meetingMonthDays: [],
  meetingDates: [],
  meetingStartsOn: null,
  meetingStartTime: '18:00',
  meetingEndTime: '22:00',
  meetingLocation: 'ENG2 Lab',
  meetingDescription: null,
  meetingCancellations: [],
  ...over,
})

const CAMPUS = 'America/New_York'

/** What the campus clock reads at an instant, as "YYYY-MM-DD HH:MM". */
const campusFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: CAMPUS,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

const onCampus = (iso: string) =>
  campusFormat.format(new Date(iso)).replace(',', '')

/** The campus weekday of an occurrence, 0-6. */
const campusWeekday = (iso: string) =>
  new Date(`${onCampus(iso).slice(0, 10)}T00:00:00Z`).getUTCDay()

const window = (from: string, to: string) =>
  [new Date(from), new Date(to)] as const

/** The campus dates a list of occurrences lands on. */
const daysOf = (out: { startsAt: string }[]) =>
  out.map((occurrence) => onCampus(occurrence.startsAt).slice(0, 10))

const SEPTEMBER = window('2035-09-01T04:00:00Z', '2035-10-01T04:00:00Z')

describe('expanding a weekly meeting', () => {
  it('lands on every named weekday and no others', async () => {
    const [from, to] = window('2035-09-01T00:00:00Z', '2035-10-01T00:00:00Z')
    const out = await expandMeetings([rover()], from, to)

    expect(out.length).toBeGreaterThan(0)
    // Tuesday and Thursday, in the zone the schedule is written in — not in
    // UTC, where a 6pm meeting is already the following day for four months of
    // the year.
    for (const occurrence of out) {
      expect([2, 4]).toContain(campusWeekday(occurrence.startsAt))
    }

    // September 2035 has nine Tuesdays and Thursdays between them.
    const days = new Set(out.map((o) => onCampus(o.startsAt).slice(0, 10)))
    expect(days.size).toBe(out.length)
  })

  it('starts and ends at the wall-clock times, whatever the date', async () => {
    const [from, to] = window('2035-09-01T00:00:00Z', '2035-10-01T00:00:00Z')
    const [first] = await expandMeetings([rover()], from, to)

    expect(first).toBeDefined()
    expect(onCampus(first!.startsAt)).toMatch(/ 18:00$/)
    expect(onCampus(first!.endsAt)).toMatch(/ 22:00$/)
  })

  /**
   * The reason the columns hold wall-clock strings rather than timestamps.
   *
   * Daylight saving ends on the first Sunday in November, so a meeting either side of it is at the
   * same hour on campus and at different instants. A naive "add seven days to the first
   * occurrence" would put every meeting after the first weekend in November an hour early, for six
   * weeks, on the public calendar.
   */
  it('holds six o clock across the end of daylight saving', async () => {
    const [from, to] = window('2035-10-25T00:00:00Z', '2035-11-20T00:00:00Z')
    const out = await expandMeetings([rover()], from, to)

    for (const occurrence of out) {
      expect(onCampus(occurrence.startsAt)).toMatch(/ 18:00$/)
    }

    // And the instants really did move: the UTC hour is not the same on both
    // sides of the transition, which is what makes the assertion above a test
    // rather than a tautology.
    const utcHours = new Set(
      out.map((o) => new Date(o.startsAt).getUTCHours()),
    )
    expect(utcHours.size).toBe(2)
  })

  /**
   * The description is the lead's, or it's nothing.
   *
   * This module used to write a sentence of its own onto every occurrence — the project's name,
   * the room, and the fact that it runs to the end of the semester, all of which the reader
   * already had. A lead who has nothing to add now gets a blank description.
   */
  it('carries the lead note as the description, and nothing when there is none', async () => {
    const [from, to] = window('2035-09-01T00:00:00Z', '2035-10-01T00:00:00Z')

    const [plain] = await expandMeetings([rover()], from, to)
    expect(plain).toBeDefined()
    expect(plain!.description).toBeNull()

    const note = 'Bring a laptop. First hour is CAD, the rest is the bench.'
    const [written] = await expandMeetings(
      [rover({ meetingDescription: note })],
      from,
      to,
    )
    expect(written!.description).toBe(note)
  })
})

describe('the bounds', () => {
  it('draws nothing before the term begins', async () => {
    // August, and classes do not begin until the 27th.
    const [from, to] = window('2035-08-01T00:00:00Z', '2035-08-27T00:00:00Z')
    const out = await expandMeetings([rover()], from, to)

    expect(out).toEqual([])
  })

  it('stops at the end of the term rather than running for ever', async () => {
    // The whole of the spring *after* this fall project's term.
    const [from, to] = window('2036-01-01T00:00:00Z', '2036-02-01T00:00:00Z')
    const out = await expandMeetings([rover()], from, to)

    expect(out).toEqual([])
  })

  it('refuses a window nobody could want', async () => {
    const from = new Date('2035-01-01T00:00:00Z')
    const to = new Date('2045-01-01T00:00:00Z')

    await expect(expandMeetings([rover()], from, to)).rejects.toThrow(
      new RegExp(String(MAX_WINDOW_DAYS)),
    )
  })

  it('says nothing about a project with no schedule', async () => {
    const [from, to] = window('2035-09-01T00:00:00Z', '2035-10-01T00:00:00Z')

    const none = await expandMeetings(
      [
        rover({
          meetingRepeat: null,
          meetingWeekdays: [],
          meetingStartTime: null,
          meetingEndTime: null,
        }),
      ],
      from,
      to,
    )

    expect(none).toEqual([])
  })
})

describe('the finals halt', () => {
  it('drops every meeting inside finals week', async () => {
    // December: two meeting weeks before finals, then finals, then nothing.
    const [from, to] = window('2035-12-01T00:00:00Z', '2035-12-20T00:00:00Z')
    const out = await expandMeetings([rover()], from, to)

    for (const occurrence of out) {
      const day = onCampus(occurrence.startsAt).slice(0, 10)
      // Finals is 6 to 12 December, and the term ends with it.
      expect(day < '2035-12-06').toBe(true)
    }

    // The 4th is a Tuesday and classes are still on, so something *is* drawn —
    // otherwise this passes by drawing nothing at all.
    expect(out.length).toBeGreaterThan(0)
  })

  it('names the exact evenings it dropped, for the calendar file', async () => {
    const [from, to] = window('2035-09-01T00:00:00Z', '2035-10-01T00:00:00Z')
    const [first] = await expandMeetings([rover()], from, to)

    const series = first!.meeting
    expect(series.skip).not.toBeNull()

    // Every skipped instant is a meeting evening inside finals week — the
    // `EXDATE` lines have to name real occurrences of the series or a calendar
    // app ignores them.
    expect(series.skipDates.length).toBeGreaterThan(0)
    for (const iso of series.skipDates) {
      expect([2, 4]).toContain(campusWeekday(iso))
      expect(onCampus(iso)).toMatch(/ 18:00$/)
      const day = onCampus(iso).slice(0, 10)
      expect(day >= '2035-12-06' && day <= '2035-12-12').toBe(true)
    }
  })

  it('carries the term end so a calendar app knows where to stop', async () => {
    const [from, to] = window('2035-09-01T00:00:00Z', '2035-10-01T00:00:00Z')
    const [first] = await expandMeetings([rover()], from, to)

    expect(onCampus(first!.meeting.untilDate).slice(0, 10)).toBe('2035-12-12')
    expect(first!.meeting.repeat).toBe(MeetingRepeat.WEEKLY)
    expect(first!.meeting.weekdays).toEqual([2, 4])
    expect(first!.meeting.startTime).toBe('18:00')
    expect(first!.meeting.endTime).toBe('22:00')
  })
})

describe('what an occurrence looks like', () => {
  it('is marked as generated, so nothing tries to edit it', async () => {
    const [from, to] = window('2035-09-01T00:00:00Z', '2035-10-01T00:00:00Z')
    const [first] = await expandMeetings([rover()], from, to)

    // The prefix is the contract with the browser: an id that starts `meeting:`
    // has no row behind it, so no page may offer an EDIT or DELETE on it.
    expect(first!.id.startsWith('meeting:')).toBe(true)
    expect(first!.title).toBe('Rover meeting')
    expect(first!.location).toBe('ENG2 Lab')
    expect(first!.type).toBe('MEETING')
    expect(first!.allDay).toBe(false)
  })

  it('reads one term per season rather than one per project', async () => {
    const fetchStub = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    const [from, to] = window('2035-09-01T00:00:00Z', '2035-10-01T00:00:00Z')

    await expandMeetings(
      [
        rover({ id: 'p-meetings-a', slug: 'test-meetings-a' }),
        rover({ id: 'p-meetings-b', slug: 'test-meetings-b' }),
        rover({ id: 'p-meetings-c', slug: 'test-meetings-c' }),
      ],
      from,
      to,
    )

    // One fetch, not three. `getTerm` caches for a day so the repeats would
    // usually be free — but "usually free" is a property of the cache, and this
    // is a loop over every project on the site.
    const asked = fetchStub.mock.calls.filter((call) =>
      String(call[0]).endsWith('2035/fall'),
    )
    expect(asked).toHaveLength(1)
  })
})

describe('every few weeks', () => {
  it('lands on alternate weeks, counted from the first date', async () => {
    const out = await expandMeetings(
      [rover({ meetingWeekdays: [3], meetingInterval: 2, meetingStartsOn: '2035-09-05' })],
      ...SEPTEMBER,
    )

    // Wednesdays: the 5th and 19th are on, the 12th and 26th are off.
    expect(daysOf(out)).toEqual(['2035-09-05', '2035-09-19'])
  })

  /**
   * Weeks run Sunday to Saturday, the way `WKST=SU` tells a calendar app. Counting in
   * days instead would split a Tuesday and Thursday pair across the on and off weeks.
   */
  it('keeps the days of one week together', async () => {
    const out = await expandMeetings(
      [rover({ meetingInterval: 2, meetingStartsOn: '2035-09-04' })],
      ...SEPTEMBER,
    )

    expect(daysOf(out)).toEqual([
      '2035-09-04',
      '2035-09-06',
      '2035-09-18',
      '2035-09-20',
    ])
  })

  it('draws nothing before the first date', async () => {
    const out = await expandMeetings(
      [rover({ meetingStartsOn: '2035-09-18' })],
      ...SEPTEMBER,
    )

    expect(daysOf(out)[0]).toBe('2035-09-18')
  })
})

describe('monthly', () => {
  it('lands on the first and third Saturday', async () => {
    const out = await expandMeetings(
      [
        rover({
          meetingRepeat: MeetingRepeat.MONTHLY_WEEKDAY,
          meetingWeekdays: [6],
          meetingMonthWeeks: [1, 3],
        }),
      ],
      ...SEPTEMBER,
    )

    expect(daysOf(out)).toEqual(['2035-09-01', '2035-09-15'])
  })

  it('lands on the last Friday, whichever week that is', async () => {
    const out = await expandMeetings(
      [
        rover({
          meetingRepeat: MeetingRepeat.MONTHLY_WEEKDAY,
          meetingWeekdays: [5],
          meetingMonthWeeks: [-1],
        }),
      ],
      ...window('2035-09-01T04:00:00Z', '2035-12-01T05:00:00Z'),
    )

    // A five-Friday month and two four-Friday ones.
    expect(daysOf(out)).toEqual(['2035-09-28', '2035-10-26', '2035-11-30'])
  })

  it('lands on the 1st and on the last day of each month', async () => {
    const out = await expandMeetings(
      [
        rover({
          meetingRepeat: MeetingRepeat.MONTHLY_DAY,
          meetingWeekdays: [],
          meetingMonthDays: [1, -1],
        }),
      ],
      ...window('2035-09-01T04:00:00Z', '2035-11-01T04:00:00Z'),
    )

    expect(daysOf(out)).toEqual([
      '2035-09-01',
      '2035-09-30',
      '2035-10-01',
      '2035-10-31',
    ])
  })
})

describe('a list of dates', () => {
  const dated = (dates: string[], over: Partial<MeetingProject> = {}) =>
    rover({
      meetingRepeat: MeetingRepeat.DATES,
      meetingWeekdays: [],
      meetingDates: dates,
      ...over,
    })

  it('lands on the dates and nowhere else', async () => {
    const out = await expandMeetings(
      [dated(['2035-09-10', '2035-09-27'])],
      ...SEPTEMBER,
    )

    expect(daysOf(out)).toEqual(['2035-09-10', '2035-09-27'])
  })

  it('still leaves finals week out', async () => {
    const out = await expandMeetings(
      [dated(['2035-12-04', '2035-12-08'])],
      ...window('2035-12-01T05:00:00Z', '2035-12-20T05:00:00Z'),
    )

    expect(daysOf(out)).toEqual(['2035-12-04'])
    expect(out[0]!.meeting.dates).toHaveLength(1)
  })

  /**
   * There's no rule a calendar app can repeat for a list, so the export writes one entry
   * per date. It gets the whole term's worth whichever month was asked for, minus the
   * cancelled ones, which a file of separate entries has no `EXDATE` to leave out.
   */
  it('hands the calendar file every date left standing', async () => {
    const [first] = await expandMeetings(
      [
        dated(['2035-09-10', '2035-10-02', '2035-11-05'], {
          meetingCancellations: [{ date: '2035-10-02', reason: null }],
        }),
      ],
      ...SEPTEMBER,
    )

    expect(daysOf(first!.meeting.dates)).toEqual(['2035-09-10', '2035-11-05'])
    expect(onCampus(first!.meeting.dates[0]!.endsAt)).toBe('2035-09-10 22:00')
    expect(first!.meeting.skipDates).toEqual([])
  })
})

describe('a cancelled meeting', () => {
  const homecoming = rover({
    meetingCancellations: [{ date: '2035-09-13', reason: 'Homecoming' }],
  })

  it('stays on the calendar, marked, with the reason', async () => {
    const out = await expandMeetings([homecoming], ...SEPTEMBER)
    const thirteenth = out.find((occurrence) =>
      onCampus(occurrence.startsAt).startsWith('2035-09-13'),
    )

    expect(thirteenth?.cancelled).toEqual({ reason: 'Homecoming' })
    expect(out.filter((occurrence) => occurrence.cancelled)).toHaveLength(1)
  })

  it('is named for the calendar file to leave out', async () => {
    const [first] = await expandMeetings([homecoming], ...SEPTEMBER)

    expect(first!.meeting.cancelledDates.map(onCampus)).toEqual([
      '2035-09-13 18:00',
    ])
  })

  it('does nothing on a day the schedule has no meeting', async () => {
    const out = await expandMeetings(
      [rover({ meetingCancellations: [{ date: '2035-09-12', reason: null }] })],
      ...SEPTEMBER,
    )

    expect(out.some((occurrence) => occurrence.cancelled)).toBe(false)
    expect(out[0]!.meeting.cancelledDates).toEqual([])
  })
})

describe('the meeting on one date', () => {
  it('is found on a meeting day, cancelled or not, and not on any other', async () => {
    const project = rover({
      meetingCancellations: [{ date: '2035-09-13', reason: null }],
    })

    expect(onCampus((await meetingOn(project, '2035-09-11'))!.startsAt)).toBe(
      '2035-09-11 18:00',
    )
    expect(await meetingOn(project, '2035-09-13')).not.toBeNull()
    expect(await meetingOn(project, '2035-09-12')).toBeNull()
  })
})
