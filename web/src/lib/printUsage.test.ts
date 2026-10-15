import { describe, expect, it } from 'vitest'
import type { ApiPrintUsage } from './api/api'
import {
  axisDate,
  axisGrams,
  buckets,
  fromDateInput,
  scaleFor,
  ticks,
  toDateInput,
  totals,
} from './printUsage'

// Local times throughout, because the graph buckets in the officer's timezone.
const local = (month: number, day: number, hour = 15) => new Date(2026, month, day, hour)
const at = (month: number, day: number, hour = 15) => local(month, day, hour).toISOString()

const print = (settledAt: string, grams: number | null, project = false): ApiPrintUsage => ({
  settledAt,
  grams,
  project,
})

describe('the columns', () => {
  it('are days for a month, weeks for a semester, months for a few years, then years', () => {
    const from = local(0, 1)
    const days = (n: number) => new Date(from.getTime() + n * 86_400_000)

    expect(scaleFor(from, days(30))).toBe('day')
    expect(scaleFor(from, days(140))).toBe('week')
    expect(scaleFor(from, days(400))).toBe('month')
    expect(scaleFor(from, days(1_200))).toBe('year')
  })

  it('run Sunday to Sunday across a semester, the current week last', () => {
    const { scale, periods } = buckets([], local(7, 9, 0), local(9, 15, 12))

    expect(scale).toBe('week')
    expect(periods[0]?.start).toEqual(new Date(2026, 7, 9))
    expect(periods.at(-1)?.start).toEqual(new Date(2026, 9, 11))
    expect(periods).toHaveLength(10)
  })
})

describe('buckets', () => {
  it('splits personal from project grams and counts prints with no figure', () => {
    const { periods } = buckets(
      [
        print(at(9, 11, 0), 10.1),
        print(at(9, 13), 20.25, true),
        print(at(9, 14), null, true),
        // The Saturday before: last week.
        print(at(9, 10, 23), 5),
        // Before the range.
        print(at(5, 1), 99),
      ],
      local(7, 9, 0),
      local(9, 15, 12),
    )

    expect(periods.at(-1)).toMatchObject({
      personal: 10.1,
      project: 20.25,
      total: 30.35,
      prints: 3,
      unmeasured: 1,
    })
    expect(periods.at(-2)).toMatchObject({ total: 5, prints: 1 })
    expect(totals(periods)).toEqual({
      personal: 15.1,
      project: 20.25,
      total: 35.35,
      prints: 4,
      unmeasured: 1,
    })
  })

  it('leaves out prints before the range even inside its first column', () => {
    // From a Wednesday, in weeks: Monday's print is in the column but not the range.
    const { periods } = buckets(
      [print(at(7, 10), 7), print(at(7, 13), 3)],
      local(7, 12, 0),
      local(9, 15),
    )

    expect(periods[0]?.start).toEqual(new Date(2026, 7, 9))
    expect(periods[0]).toMatchObject({ total: 3, prints: 1 })
  })

  it('adds hundredths without floating-point dust', () => {
    const { periods } = buckets(
      [print(at(9, 1), 0.1), print(at(9, 1, 16), 0.2)],
      local(9, 1, 0),
      local(9, 15),
    )

    expect(periods[0]?.total).toBe(0.3)
  })
})

describe('date fields', () => {
  it('read and write a local day', () => {
    expect(toDateInput(local(9, 5))).toBe('2026-10-05')
    expect(fromDateInput('2026-10-05')).toEqual(new Date(2026, 9, 5))
    expect(fromDateInput('2026-10-05', true)).toEqual(new Date(2026, 9, 5, 23, 59, 59, 999))
    expect(fromDateInput('')).toBeNull()
  })
})

describe('the axes', () => {
  it('picks round gridlines that reach the tallest column', () => {
    expect(ticks(100)).toEqual([0, 25, 50, 75, 100])
    expect(ticks(123.45)).toEqual([0, 50, 100, 150])
    expect(ticks(1800)).toEqual([0, 500, 1000, 1500, 2000])
    expect(ticks(0.3)).toEqual([0, 0.1, 0.2, 0.3])
  })

  it('writes grams and kilograms', () => {
    expect(axisGrams(250)).toBe('250 g')
    expect(axisGrams(1500)).toBe('1.5 kg')
  })

  it('names January, and a year, by the year', () => {
    expect(axisDate(new Date(2027, 0, 1), 'month')).toBe('2027')
    expect(axisDate(new Date(2027, 0, 1), 'year')).toBe('2027')
  })
})
