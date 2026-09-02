import { describe, expect, it } from 'vitest'
import {
  ANY,
  academicYear,
  academicYearOf,
  filterTerms,
  groupByYear,
  matchesTerm,
  servedRange,
  yearOf,
  yearsIn,
} from './officerTerms'
import type { ApiOfficerTerm, OfficerPosition } from './api/api'

/**
 * A term, given the academic years it spanned. August to May, which is what
 * `academicYear` reads back out — the fixtures stay written in years because
 * that is how anybody talks about a board, and the dates are the storage.
 */
const term = (
  position: OfficerPosition | null,
  startYear: number,
  endYear: number,
  fullName: string,
): ApiOfficerTerm => ({
  id: `${position ?? 'NONE'}-${String(startYear)}-${fullName}`,
  position,
  startedAt: `${String(startYear)}-08-01T00:00:00.000Z`,
  endedAt:
    endYear > startYear
      ? `${String(endYear)}-05-31T00:00:00.000Z`
      : `${String(startYear)}-12-31T00:00:00.000Z`,
  fullName,
  photoUrl: null,
  profileUrl: null,
})

/** In the order the server sends it: newest start first, board order inside. */
const archive: ApiOfficerTerm[] = [
  term('PRESIDENT', 2024, 2025, 'Priya Raman'),
  term('TREASURER', 2024, 2025, 'Elena Vasquez'),
  term('PRESIDENT', 2023, 2024, 'Grace Okonkwo'),
  term('FACULTY_ADVISOR', 2022, 2025, 'Dr. Harold Kimura'),
  term('PRESIDENT', 2022, 2023, 'Ryan Delacroix'),
  term('PRESIDENT', 2022, 2023, 'Mei-Lin Zhao'),
]

const AUG_2024 = '2024-08-01T00:00:00.000Z'
const MAY_2025 = '2025-05-31T00:00:00.000Z'

describe('academicYear', () => {
  it('writes a term spanning two academic years as a range', () => {
    expect(academicYear(AUG_2024, MAY_2025)).toBe('2024–2025')
  })

  /**
   * An academic year is two calendar years whatever fraction of it somebody
   * served, so an autumn interim is filed with the board they sat alongside
   * rather than under a heading of their own.
   */
  it('writes a single-semester term as the whole academic year', () => {
    expect(academicYear(AUG_2024, '2024-12-31T00:00:00.000Z')).toBe('2024–2025')
  })

  /** A term across several reads end to end: August 2022 to May 2025. */
  it('writes a multi-year term from its first year to its last', () => {
    expect(academicYear('2022-08-01T00:00:00.000Z', MAY_2025)).toBe('2022–2025')
  })

  /**
   * **The grouping must not move with the reader's clock.** Midnight UTC on 1
   * August is the previous July in Orlando, so reading the month locally would
   * file the whole board a year early here and correctly in Berlin — two
   * visitors, two different histories.
   */
  it('reads the month in UTC, not in the reader s zone', () => {
    expect(academicYear(AUG_2024, MAY_2025)).toBe('2024–2025')
    expect(academicYearOf(new Date(AUG_2024))).toBe(2024)
  })

  /**
   * **August is the cut-over, and this is the case that pins it.** A term
   * running January to May 2025 is the back half of the 2024–2025 board, not
   * the front of 2025–2026 — filing it under 2025 would split one year's
   * officers across two headings.
   */
  it('files a spring-only term under the year its August began', () => {
    expect(academicYear('2025-01-13T00:00:00.000Z', MAY_2025)).toBe('2024–2025')
  })

  /** Somebody still serving. The archive never draws one, but the value has to
      be defined rather than an empty half of a range. */
  it('writes an open term as running to the present', () => {
    expect(academicYear(AUG_2024, null)).toBe('2024–present')
  })

  /** A range gets an en dash. A hyphen is for compound words. */
  it('uses an en dash', () => {
    expect(academicYear(AUG_2024, MAY_2025)).toContain('–')
    expect(academicYear(AUG_2024, MAY_2025)).not.toContain('-')
  })
})

describe('servedRange', () => {
  /** Month and year, never the day: a term closes when the *sync* noticed a
      Discord role had gone, which is not the day the club decided anything. */
  it('prints the span to the month', () => {
    const range = servedRange(AUG_2024, MAY_2025)

    expect(range).toMatch(/2024/)
    expect(range).toMatch(/2025/)
    expect(range).not.toMatch(/31/)
  })

  it('says present for a term still running', () => {
    expect(servedRange(AUG_2024, null)).toMatch(/present$/)
  })
})

describe('yearsIn', () => {
  /**
   * The server decides the order — it can see how `OfficerPosition` is declared
   * and the browser cannot — so this only ever deduplicates. If it ever starts
   * sorting, the chips and the headings have two opinions about the archive.
   */
  it('keeps the order the archive arrived in, once each', () => {
    expect(yearsIn(archive)).toEqual([
      '2024–2025',
      '2023–2024',
      '2022–2025',
      '2022–2023',
    ])
  })

  it('has nothing to say about an empty archive', () => {
    expect(yearsIn([])).toEqual([])
  })
})

describe('matchesTerm', () => {
  it('matches every word of a name in any order', () => {
    const priya = term('PRESIDENT', 2024, 2025, 'Priya Raman')

    expect(matchesTerm(priya, 'raman priya')).toBe(true)
    expect(matchesTerm(priya, 'PRIYA')).toBe(true)
    expect(matchesTerm(priya, 'okonkwo')).toBe(false)
  })

  it('matches everything on an empty search', () => {
    expect(matchesTerm(archive[0]!, '   ')).toBe(true)
  })

  /**
   * The seat and the year have chips of their own. A box that matched them too
   * would make those chips look broken — type "president", get every president,
   * press the president chip, watch nothing change.
   */
  it('does not search the seat or the year', () => {
    expect(matchesTerm(term('PRESIDENT', 2024, 2025, 'Priya Raman'), 'president')).toBe(
      false,
    )
    expect(matchesTerm(term('PRESIDENT', 2024, 2025, 'Priya Raman'), '2024')).toBe(false)
  })
})

describe('filterTerms', () => {
  const all = { query: '', position: ANY, year: ANY } as const

  it('returns the whole archive at rest', () => {
    expect(filterTerms(archive, all)).toHaveLength(archive.length)
  })

  it('narrows to one seat', () => {
    const presidents = filterTerms(archive, { ...all, position: 'PRESIDENT' })

    expect(presidents).toHaveLength(4)
    expect(presidents.every((held) => held.position === 'PRESIDENT')).toBe(true)
  })

  /** The chip's value is the printed label, so a span and a plain year are
      filtered by exactly the string the heading shows. */
  it('narrows to one year, span and all', () => {
    expect(filterTerms(archive, { ...all, year: '2022–2023' })).toHaveLength(2)
    expect(filterTerms(archive, { ...all, year: '2022–2025' })).toHaveLength(1)
  })

  /** All three at once is the point — "every president, that year" is a press
      and a press, not a choice between them. */
  it('composes the search, the seat and the year', () => {
    expect(
      filterTerms(archive, {
        query: 'mei',
        position: 'PRESIDENT',
        year: '2022–2023',
      }),
    ).toEqual([term('PRESIDENT', 2022, 2023, 'Mei-Lin Zhao')])

    // The same name under a seat they never held finds nothing, rather than
    // the search quietly winning over the chip.
    expect(
      filterTerms(archive, { query: 'mei', position: 'TREASURER', year: ANY }),
    ).toEqual([])
  })
})

describe('groupByYear', () => {
  it('groups in the order the terms arrived', () => {
    expect(groupByYear(archive).map((group) => group.year)).toEqual([
      '2024–2025',
      '2023–2024',
      '2022–2025',
      '2022–2023',
    ])
  })

  /**
   * Two people in one seat in one year is a resignation mid-term, which the
   * schema allows on purpose. Both belong under the one heading.
   */
  it('keeps two holders of one seat in one year together', () => {
    const group = groupByYear(archive).find(({ year }) => year === '2022–2023')

    expect(group?.terms.map((held) => held.fullName)).toEqual([
      'Ryan Delacroix',
      'Mei-Lin Zhao',
    ])
  })

  /** Filtering first is what stops a heading being left behind with nothing
      under it. */
  it('leaves no empty heading behind a filter', () => {
    const groups = groupByYear(
      filterTerms(archive, { query: '', position: 'TREASURER', year: ANY }),
    )

    expect(groups).toEqual([
      { year: '2024–2025', terms: [term('TREASURER', 2024, 2025, 'Elena Vasquez')] },
    ])
  })
})

describe('yearOf', () => {
  it('is what the heading and the chip both read', () => {
    expect(yearOf(archive[0]!)).toBe('2024–2025')
    expect(yearOf(archive[3]!)).toBe('2022–2025')
  })
})
