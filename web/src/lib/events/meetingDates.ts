import type { ApiTermDates } from '../api/api'
import { campusDateOf } from './calendarLinks'

/**
 * The arithmetic behind the meeting date picker: which days a month grid shows and which of
 * them a lead may pick.
 *
 * Everything is a campus date string, "2026-09-23", the form `Project.meetingDates` stores,
 * and the maths runs on `Date.UTC` so no zone ever gets a say in which square a day is.
 */

/** The days that can hold a meeting: the term, less finals week. */
export type TermBounds = {
  first: string
  last: string
  finals: { from: string; to: string } | null
}

/** A calendar month, 1-12. */
export type Month = { year: number; month: number }

const DAY_MS = 24 * 60 * 60 * 1000

const pad = (value: number) => String(value).padStart(2, '0')

const parts = (date: string) => {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number)
  return { year, month, day }
}

const stamp = (at: Date) =>
  `${String(at.getUTCFullYear())}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`

/** The term's instants as the campus dates they fall on. */
export function termBounds(term: ApiTermDates): TermBounds {
  return {
    first: campusDateOf(term.startsAt),
    last: campusDateOf(term.endsAt),
    finals:
      term.finalsStartAt && term.finalsEndAt
        ? { from: campusDateOf(term.finalsStartAt), to: campusDateOf(term.finalsEndAt) }
        : null,
  }
}

/** Which weekday a date is, 0-6 with Sunday first. */
export function weekdayOf(date: string): number {
  const { year, month, day } = parts(date)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

/** The date `days` after this one. */
export function shiftDate(date: string, days: number): string {
  const { year, month, day } = parts(date)
  return stamp(new Date(Date.UTC(year, month - 1, day) + days * DAY_MS))
}

export const monthOf = (date: string): Month => {
  const { year, month } = parts(date)
  return { year, month }
}

export function shiftMonth({ year, month }: Month, by: number): Month {
  const at = new Date(Date.UTC(year, month - 1 + by, 1))
  return { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1 }
}

/** Negative when `a` is the earlier month. */
export const compareMonths = (a: Month, b: Month) =>
  a.year * 12 + a.month - (b.year * 12 + b.month)

const daysIn = ({ year, month }: Month) => new Date(Date.UTC(year, month, 0)).getUTCDate()

/** The same day of the month in another month, pulled back to its last day if it's short. */
export function sameDayIn(date: string, target: Month): string {
  const day = Math.min(parts(date).day, daysIn(target))
  return `${String(target.year)}-${pad(target.month)}-${pad(day)}`
}

/**
 * The month as rows of seven, Sunday first like the site's other calendar, padded with nulls
 * so the grid keeps its rectangle whichever weekday the 1st lands on.
 */
export function monthGrid(view: Month): (string | null)[][] {
  const leading = new Date(Date.UTC(view.year, view.month - 1, 1)).getUTCDay()
  const cells: (string | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from(
      { length: daysIn(view) },
      (_, index) => `${String(view.year)}-${pad(view.month)}-${pad(index + 1)}`,
    ),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  return Array.from({ length: cells.length / 7 }, (_, week) =>
    cells.slice(week * 7, week * 7 + 7),
  )
}

/**
 * Why a day can't be picked, or null when it can. The same three refusals the server makes,
 * asked before the click rather than after SAVE. Without the term's dates only the past is
 * known, and the server still has the last word.
 */
export function whyNot(
  date: string,
  today: string,
  bounds: TermBounds | null,
): 'past' | 'outside' | 'finals' | null {
  if (date < today) return 'past'
  if (!bounds) return null
  if (date < bounds.first || date > bounds.last) return 'outside'
  if (bounds.finals && date >= bounds.finals.from && date <= bounds.finals.to) {
    return 'finals'
  }
  return null
}

/**
 * The months worth paging through: from this one, or the term's first if that's later, to
 * the term's last. With no term known, a year ahead, which is further than any term runs.
 */
export function pickerRange(today: string, bounds: TermBounds | null) {
  const from = monthOf(bounds && bounds.first > today ? bounds.first : today)
  const to = bounds ? monthOf(bounds.last) : shiftMonth(monthOf(today), 12)
  return { from, to: compareMonths(to, from) < 0 ? from : to }
}

/** Where the grid opens: the month of the next date already picked, or the first open one. */
export function openingMonth(
  dates: string[],
  today: string,
  bounds: TermBounds | null,
): Month {
  const { from } = pickerRange(today, bounds)
  const next = dates.find((date) => date >= today)
  return next && compareMonths(monthOf(next), from) >= 0 ? monthOf(next) : from
}
