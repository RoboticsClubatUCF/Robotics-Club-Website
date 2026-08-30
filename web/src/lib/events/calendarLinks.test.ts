import { describe, expect, it } from 'vitest'
import {
  googleCalendarUrl,
  icsFilename,
  icsFor,
  seriesSummary,
} from './calendarLinks'
import type { ApiEvent, ApiMeetingSeries } from '../api/api'

/**
 * The two files somebody's calendar app actually reads.
 *
 * Neither is rendered, so nothing here is about what a page looks like — it is
 * about a string a *different* program parses, which is the one kind of output
 * where being nearly right produces silence rather than a visible mistake. An
 * unescaped comma truncates a description, a `UNTIL` without its `Z` makes a
 * series that never ends, and a floating time is an hour out for six weeks of
 * the year.
 *
 * Instants are written in UTC and asserted against the campus wall clock, since
 * that is the whole claim: 22:00Z in September and 23:00Z in December are both
 * six in the evening in Orlando.
 */

const NOW = new Date('2035-09-01T12:00:00Z')

const event = (over: Partial<ApiEvent> = {}): ApiEvent => ({
  id: 'e1',
  slug: 'design-review',
  title: 'Design review',
  description: null,
  type: 'MEETING',
  location: null,
  // 18:00 Eastern on Thursday 6 September 2035, which is EDT — UTC-4.
  startsAt: '2035-09-06T22:00:00.000Z',
  endsAt: '2035-09-07T02:00:00.000Z',
  allDay: false,
  registrationUrl: null,
  ...over,
})

const series = (over: Partial<ApiMeetingSeries> = {}): ApiMeetingSeries => ({
  projectSlug: 'rover',
  projectTitle: 'Rover',
  weekdays: [2, 4],
  startTime: '18:00',
  endTime: '22:00',
  untilDate: '2035-12-13T04:59:59.999Z',
  location: 'ENG2 Lab',
  skip: { from: '2035-12-06T05:00:00.000Z', to: '2035-12-13T04:59:59.999Z' },
  skipDates: ['2035-12-06T23:00:00.000Z', '2035-12-11T23:00:00.000Z'],
  ...over,
})

/** The lines of an .ics, unfolded, so an assertion can look for a whole one. */
const linesOf = (ics: string) => ics.replace(/\r\n /g, '').split('\r\n')

describe('the .ics file', () => {
  it('is a calendar a parser will accept', () => {
    const lines = linesOf(icsFor(event(), NOW))

    expect(lines[0]).toBe('BEGIN:VCALENDAR')
    expect(lines).toContain('VERSION:2.0')
    expect(lines[lines.length - 1]).toBe('END:VCALENDAR')
    // CRLF is not a style choice here: the spec says so and Outlook enforces it.
    expect(icsFor(event(), NOW)).toContain('\r\n')
  })

  it('pins the time to the campus zone and carries the rule for it', () => {
    const lines = linesOf(icsFor(event(), NOW))

    // Six in the evening in Orlando, said as a wall clock plus a zone — not as
    // the UTC instant, which would drift an hour when the clocks go back.
    expect(lines).toContain('DTSTART;TZID=America/New_York:20350906T180000')
    expect(lines).toContain('DTEND;TZID=America/New_York:20350906T220000')

    // And the zone's own rule travels with it, because the importing app is
    // entitled not to know what America/New_York means.
    expect(lines).toContain('BEGIN:VTIMEZONE')
    expect(lines).toContain('TZID:America/New_York')
    expect(lines).toContain('RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU')
  })

  it('escapes the characters that would silently truncate a field', () => {
    const lines = linesOf(
      icsFor(
        event({
          title: 'Build, test; repeat',
          description: 'Bring a laptop, a mug\nand patience',
        }),
        NOW,
      ),
    )

    // A bare comma is a value separator in this format — the single most common
    // way to lose the second half of a description.
    expect(lines).toContain('SUMMARY:Build\\, test\\; repeat')
    expect(
      lines.some((line) =>
        line.startsWith('DESCRIPTION:Bring a laptop\\, a mug\\nand patience'),
      ),
    ).toBe(true)
  })

  it('folds long lines by bytes, not by characters', () => {
    // Em dashes are three bytes each, so a line legal by `.length` can be over
    // the limit by the count that matters. Outlook is the one that notices.
    const ics = icsFor(
      event({ description: `${'a — b '.repeat(40)}` }),
      NOW,
    )

    for (const line of ics.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    }
  })

  it('writes no recurrence for a one-off', () => {
    const ics = icsFor(event(), NOW)

    expect(ics).not.toContain('RRULE:FREQ=WEEKLY')
    expect(ics).not.toContain('EXDATE')
  })
})

describe('a recurring meeting', () => {
  it('repeats on the named days and stops at the end of the term', () => {
    const lines = linesOf(
      icsFor(event({ meeting: series(), title: 'Rover meeting' }), NOW),
    )

    // `UNTIL` in UTC with a `Z`, which the spec requires once `DTSTART` carries
    // a `TZID`. Getting it wrong is the classic never-ending series.
    expect(lines).toContain(
      'RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20351213T045959Z',
    )
  })

  it('punches finals week out of the series', () => {
    const lines = linesOf(icsFor(event({ meeting: series() }), NOW))

    // One line, comma-separated, naming real occurrences of the series to the
    // second — a calendar app ignores an `EXDATE` that does not match one.
    expect(lines).toContain(
      'EXDATE;TZID=America/New_York:20351206T180000,20351211T180000',
    )
  })

  it('leaves the exceptions out when no finals week is set', () => {
    const ics = icsFor(
      event({ meeting: series({ skip: null, skipDates: [] }) }),
      NOW,
    )

    expect(ics).toContain('RRULE:FREQ=WEEKLY')
    expect(ics).not.toContain('EXDATE')
  })

  it('keys the whole series on one id, so re-adding it does not duplicate', () => {
    const first = icsFor(
      event({ id: 'meeting:p1:a', meeting: series() }),
      NOW,
    )
    const second = icsFor(
      event({ id: 'meeting:p1:b', meeting: series() }),
      NOW,
    )

    // Two different evenings of the same series. Adding the term from either
    // one has to produce the same entry, not two overlapping ones.
    const uid = (ics: string) =>
      linesOf(ics).find((line) => line.startsWith('UID:'))
    expect(uid(first)).toBe(uid(second))
  })
})

describe('the Google link', () => {
  it('sends a wall clock and a zone rather than an instant', () => {
    const url = new URL(googleCalendarUrl(event()))

    expect(url.origin + url.pathname).toBe(
      'https://calendar.google.com/calendar/render',
    )
    expect(url.searchParams.get('action')).toBe('TEMPLATE')
    expect(url.searchParams.get('text')).toBe('Design review')
    // Local format with `ctz`, deliberately: UTC instants would be right for
    // the first meeting and an hour out from November.
    expect(url.searchParams.get('dates')).toBe(
      '20350906T180000/20350906T220000',
    )
    expect(url.searchParams.get('ctz')).toBe('America/New_York')
  })

  it('carries the recurrence and its exceptions', () => {
    const url = new URL(googleCalendarUrl(event({ meeting: series() })))
    const recur = url.searchParams.get('recur') ?? ''

    expect(recur).toContain('RRULE:FREQ=WEEKLY;BYDAY=TU,TH')
    expect(recur).toContain('EXDATE;TZID=America/New_York:')
  })

  it('has no recurrence for a one-off', () => {
    const url = new URL(googleCalendarUrl(event()))
    expect(url.searchParams.get('recur')).toBeNull()
  })
})

describe('an all-day event', () => {
  it('uses dates and closes the day after, which is what DTEND means', () => {
    const lines = linesOf(
      icsFor(
        event({
          allDay: true,
          startsAt: '2035-09-06T04:00:00.000Z',
          endsAt: '2035-09-06T04:00:00.000Z',
        }),
        NOW,
      ),
    )

    expect(lines).toContain('DTSTART;VALUE=DATE:20350906')
    // Exclusive. Without the day added, a one-day event imports as zero days
    // long and vanishes from most calendars.
    expect(lines).toContain('DTEND;VALUE=DATE:20350907')
    // No zoned time in the file, so the zone block would be pointing at nothing.
    expect(lines).not.toContain('BEGIN:VTIMEZONE')
  })
})

describe('what the button says', () => {
  it('names the last date and the week it skips', () => {
    const summary = seriesSummary(series())

    expect(summary).toContain('Repeats weekly until')
    expect(summary).toContain('finals week')
  })

  it('says nothing about finals when none is set', () => {
    expect(seriesSummary(series({ skip: null, skipDates: [] }))).not.toContain(
      'finals',
    )
  })

  it('gives the download a name somebody will recognise', () => {
    expect(icsFilename(event({ title: 'Design Review!' }))).toBe(
      'design-review.ics',
    )
  })
})
