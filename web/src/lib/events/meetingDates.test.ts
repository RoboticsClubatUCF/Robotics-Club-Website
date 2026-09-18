import { describe, expect, it } from 'vitest'
import {
  monthGrid,
  openingMonth,
  pickerRange,
  sameDayIn,
  shiftDate,
  termBounds,
  whyNot,
} from './meetingDates'

/**
 * The date picker's arithmetic, all on campus date strings. Fall 2035 as UCF would publish
 * it: classes from 24 August, finals 7 to 13 December, and the term over with them.
 */
const FALL = termBounds({
  year: 2035,
  season: 'FALL',
  startsAt: '2035-08-24T04:00:00.000Z',
  endsAt: '2035-12-14T04:59:59.999Z',
  finalsStartAt: '2035-12-07T05:00:00.000Z',
  finalsEndAt: '2035-12-14T04:59:59.999Z',
})

describe('termBounds', () => {
  /** Instants read as Orlando's dates: the end is a moment before midnight on the 13th. */
  it('reads the term as the campus dates it covers', () => {
    expect(FALL).toEqual({
      first: '2035-08-24',
      last: '2035-12-13',
      finals: { from: '2035-12-07', to: '2035-12-13' },
    })
  })
})

describe('moving about', () => {
  it('steps across the ends of months and years', () => {
    expect(shiftDate('2035-08-31', 1)).toBe('2035-09-01')
    expect(shiftDate('2035-12-28', 7)).toBe('2036-01-04')
    expect(shiftDate('2036-03-01', -1)).toBe('2036-02-29')
  })

  it('keeps the day of the month, short months pulling it back', () => {
    expect(sameDayIn('2035-10-15', { year: 2035, month: 11 })).toBe('2035-11-15')
    expect(sameDayIn('2036-01-31', { year: 2036, month: 2 })).toBe('2036-02-29')
  })
})

describe('monthGrid', () => {
  it('pads the month to whole weeks, Sunday first', () => {
    // September 2035 starts on a Saturday.
    const grid = monthGrid({ year: 2035, month: 9 })

    expect(grid[0]).toEqual([null, null, null, null, null, null, '2035-09-01'])
    expect(grid.every((week) => week.length === 7)).toBe(true)
    expect(grid.flat().filter(Boolean)).toHaveLength(30)
  })
})

describe('whyNot', () => {
  it('refuses the past, outside the term and finals week, and nothing else', () => {
    const today = '2035-09-10'

    expect(whyNot('2035-09-09', today, FALL)).toBe('past')
    expect(whyNot('2035-09-10', today, FALL)).toBeNull()
    expect(whyNot('2035-12-06', today, FALL)).toBeNull()
    expect(whyNot('2035-12-07', today, FALL)).toBe('finals')
    expect(whyNot('2035-12-20', today, FALL)).toBe('outside')
  })

  /** The term read can fail. Then only the past is known, and the server has the last word. */
  it('knows only the past when the term is unknown', () => {
    expect(whyNot('2035-12-20', '2035-09-10', null)).toBeNull()
    expect(whyNot('2035-09-01', '2035-09-10', null)).toBe('past')
  })
})

describe('where the grid opens and how far it goes', () => {
  it('runs from now to the end of the term', () => {
    expect(pickerRange('2035-09-10', FALL)).toEqual({
      from: { year: 2035, month: 9 },
      to: { year: 2035, month: 12 },
    })
  })

  it('starts at the term when the term has not started', () => {
    expect(pickerRange('2035-05-01', FALL).from).toEqual({ year: 2035, month: 8 })
  })

  it('opens on the next date already picked', () => {
    expect(openingMonth(['2035-09-01', '2035-11-05'], '2035-09-10', FALL)).toEqual({
      year: 2035,
      month: 11,
    })
    expect(openingMonth([], '2035-09-10', FALL)).toEqual({ year: 2035, month: 9 })
  })
})
