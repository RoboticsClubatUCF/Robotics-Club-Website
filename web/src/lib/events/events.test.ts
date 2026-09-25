import { describe, expect, it } from 'vitest'
import type { ApiEvent } from '../api/api'
import { eventInstants, listedWhen, toEndDateInput } from './events'

/**
 * The form fields are local time, so every expected instant is built the same way rather than
 * written out in UTC — the suite runs in whatever zone the machine is in.
 */
const local = (value: string) => new Date(value).toISOString()

const fields = (over: Partial<Parameters<typeof eventInstants>[0]> = {}) => ({
  date: '2035-09-20',
  start: '18:00',
  endDate: '',
  end: '',
  allDay: false,
  ...over,
})

const event = (over: Partial<ApiEvent> = {}): ApiEvent => ({
  id: 'e1',
  slug: 'kickoff',
  title: 'Kickoff',
  description: null,
  type: 'COMPETITION',
  location: null,
  startsAt: local('2035-09-20T18:00'),
  endsAt: null,
  allDay: false,
  registrationUrl: null,
  ...over,
})

describe('eventInstants', () => {
  it('ends on the start date when the end date is empty', () => {
    expect(eventInstants(fields({ end: '21:00' }))).toEqual({
      startsAt: local('2035-09-20T18:00'),
      endsAt: local('2035-09-20T21:00'),
    })
  })

  it('leaves the end off when nothing says when it ends', () => {
    expect(eventInstants(fields())).toEqual({
      startsAt: local('2035-09-20T18:00'),
      endsAt: null,
    })
  })

  it('runs past midnight onto the end date', () => {
    expect(
      eventInstants(fields({ endDate: '2035-09-22', end: '14:00' })),
    ).toEqual({
      startsAt: local('2035-09-20T18:00'),
      endsAt: local('2035-09-22T14:00'),
    })
  })

  it('covers every day of an all-day run and ignores the times', () => {
    expect(
      eventInstants(
        fields({ endDate: '2035-09-22', start: '', end: '09:00', allDay: true }),
      ),
    ).toEqual({
      startsAt: local('2035-09-20T00:00'),
      endsAt: local('2035-09-22T23:59'),
    })
  })

  it('refuses an end date with no end time rather than inventing one', () => {
    expect(eventInstants(fields({ endDate: '2035-09-22' }))).toEqual({
      error: 'An event ending on another day needs an end time.',
    })
  })

  it('refuses an end date before the start date', () => {
    expect(
      eventInstants(fields({ endDate: '2035-09-19', allDay: true })),
    ).toEqual({ error: 'The end date is before the start date.' })
  })

  it('points a same-day end before the start at the end date', () => {
    expect(eventInstants(fields({ start: '22:00', end: '02:00' }))).toEqual({
      error:
        "The end time isn't after the start time. If it runs past midnight, set an end date.",
    })
  })

  it('asks for a start time instead of throwing on an empty one', () => {
    expect(eventInstants(fields({ start: '' }))).toEqual({
      error: 'Add a start time, or make it all day.',
    })
  })
})

describe('toEndDateInput', () => {
  it('is blank for an event that ends the day it starts', () => {
    expect(toEndDateInput(event({ endsAt: local('2035-09-20T21:00') }))).toBe('')
    expect(toEndDateInput(event())).toBe('')
  })

  it('is the last day for an event that runs longer', () => {
    expect(toEndDateInput(event({ endsAt: local('2035-09-22T14:00') }))).toBe(
      '2035-09-22',
    )
  })
})

describe('listedWhen', () => {
  it('names both ends of a run over several days', () => {
    const run = listedWhen(
      event({ endsAt: local('2035-09-22T23:59'), allDay: true }),
    )
    expect(run).toMatch(/Sep\s20/)
    expect(run).toMatch(/Sep\s22/)
    // All day, so no clock time on either end.
    expect(run).not.toMatch(/\d:\d\d/)
  })

  it('only lets a narrow row wrap between the two ends', () => {
    const run = listedWhen(event({ endsAt: local('2035-09-22T14:00') }))
    const ends = run.split(' – ')
    expect(ends).toHaveLength(2)
    for (const end of ends) expect(end).not.toContain(' ')
  })

  it('gives one date and a time for a single evening', () => {
    const one = listedWhen(event({ endsAt: local('2035-09-20T21:00') }))
    expect(one).toMatch(/Sep\s20/)
    expect(one).not.toContain('–')
  })
})
