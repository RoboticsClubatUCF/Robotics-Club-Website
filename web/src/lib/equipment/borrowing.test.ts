import { describe, expect, it } from 'vitest'
import {
  addDays,
  daysBetween,
  endOfDay,
  isDateValue,
  startOfDay,
  windowFault,
} from './borrowing'

/**
 * The date box hands back strings, and one of them is a trap.
 *
 * `<input type="date">` accepts a year of four *or more* digits, so a slipped
 * keystroke produces `12345-08-14`. `new Date` cannot parse that at all, and
 * everything downstream of an Invalid Date fails quietly: `NaN` compares false
 * against every bound, two values of different lengths compare backwards as
 * strings, and `.toISOString()` throws. This file is the tripwire on all three.
 */

const OVERLONG = '12345-08-14'

describe('isDateValue', () => {
  it('takes a four-digit year and nothing wider', () => {
    expect(isDateValue('2026-08-14')).toBe(true)
    expect(isDateValue(OVERLONG)).toBe(false)
    expect(isDateValue('275760-09-13')).toBe(false)
    expect(isDateValue('+002026-08-14')).toBe(false)
  })

  it('refuses a day that does not exist rather than rolling it forward', () => {
    // `new Date` would quietly make this 3 March and never mention it.
    expect(isDateValue('2026-02-31')).toBe(false)
    expect(isDateValue('2026-13-01')).toBe(false)
    expect(isDateValue('2028-02-29')).toBe(true)
  })

  it('refuses the empty box and anything that is not a date at all', () => {
    expect(isDateValue('')).toBe(false)
    expect(isDateValue('next tuesday')).toBe(false)
  })
})

describe('the arithmetic', () => {
  it('counts whole days between two days', () => {
    expect(daysBetween('2026-08-14', '2026-08-21')).toBe(7)
    expect(daysBetween('2026-08-14', '2026-08-14')).toBe(0)
    expect(daysBetween('2026-08-21', '2026-08-14')).toBe(-7)
  })

  /** The whole point: null, never NaN, because NaN loses every comparison. */
  it('answers null rather than NaN when an end is unreadable', () => {
    expect(daysBetween(OVERLONG, '2026-08-21')).toBeNull()
    expect(daysBetween('2026-08-14', OVERLONG)).toBeNull()
  })

  it('counts across a daylight-saving change as whole days', () => {
    // US clocks go back on 1 November 2026; parsed as UTC, this is still 7.
    expect(daysBetween('2026-10-29', '2026-11-05')).toBe(7)
  })

  it('empties rather than throwing when asked to add days to a non-date', () => {
    expect(addDays('2026-08-14', 7)).toBe('2026-08-21')
    expect(addDays(OVERLONG, 7)).toBe('')
    expect(addDays('', 7)).toBe('')
  })

  it('gives no instant for a non-date instead of throwing a RangeError', () => {
    expect(startOfDay(OVERLONG)).toBeNull()
    expect(endOfDay(OVERLONG)).toBeNull()
  })

  /**
   * Both ends are the member's *local* day, so west of Greenwich the end of it
   * is already tomorrow in UTC. That is the intent — "back by Friday" means
   * Friday where the member is standing — and asserting on the local reading
   * is the only way to say so without pinning the suite to one timezone.
   */
  it('brackets the chosen day in the reader’s own timezone', () => {
    const start = new Date(startOfDay('2026-08-14')!)
    const end = new Date(endOfDay('2026-08-14')!)

    expect(start.toLocaleDateString('en-CA')).toBe('2026-08-14')
    expect(end.toLocaleDateString('en-CA')).toBe('2026-08-14')
    expect(end.getHours()).toBe(23)
    expect(start.getTime()).toBeLessThan(end.getTime())
  })
})

describe('windowFault', () => {
  it('passes a window inside the cap', () => {
    expect(windowFault('2026-08-14', '2026-08-21', 7)).toBeNull()
    // The cap exactly, and a same-day loan, are both fine.
    expect(windowFault('2026-08-14', '2026-08-14', 7)).toBeNull()
  })

  it('catches a window past the cap', () => {
    expect(windowFault('2026-08-14', '2026-08-22', 7)).toBe('too-long')
  })

  it('catches a return date before the start', () => {
    expect(windowFault('2026-08-21', '2026-08-14', 7)).toBe('backwards')
  })

  /** A question nobody has answered yet is not a mistake they have made. */
  it('says nothing about an empty return date', () => {
    expect(windowFault('2026-08-14', '', 7)).toBeNull()
  })

  /**
   * But a broken *start* is still worth saying with the box below it empty —
   * otherwise clearing that box clears the complaint about this one.
   */
  it('still names a broken start when there is no return date', () => {
    expect(windowFault(OVERLONG, '', 7)).toBe('start')
  })

  /**
   * The regression. Before this, an over-long year made `daysBetween` NaN,
   * `NaN > 7` false, and the cap check waved through a loan of three hundred
   * millennia. It also compared *backwards* as a string, so the two wrong
   * answers could not even be relied on to be consistently wrong.
   */
  it('names the broken box rather than passing the cap check', () => {
    expect(windowFault('2026-08-14', OVERLONG, 7)).toBe('due')
    expect(windowFault(OVERLONG, '2026-08-21', 7)).toBe('start')
    expect(windowFault(OVERLONG, OVERLONG, 7)).toBe('start')
  })
})
