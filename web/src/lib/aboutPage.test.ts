import { describe, expect, it } from 'vitest'
import { figureAt, splitFigure } from './aboutPage'

describe('splitFigure', () => {
  it('splits the number from the words after it', () => {
    expect(splitFigure('50+ years')).toEqual({
      lead: '50+',
      counts: true,
      before: '',
      value: 50,
      grouped: false,
      decimals: 0,
      after: '+',
      unit: 'years',
    })
  })

  it('keeps a currency sign and thousands commas', () => {
    const figure = splitFigure('$15,000 annually')

    expect(figure.before).toBe('$')
    expect(figure.value).toBe(15000)
    expect(figure.grouped).toBe(true)
    expect(figure.unit).toBe('annually')
    expect(figure.counts).toBe(true)
  })

  it('keeps every word of a longer unit', () => {
    expect(splitFigure('7 active projects').unit).toBe('active projects')
  })

  it('prints a figure with no number as written', () => {
    const figure = splitFigure('Dozens')

    expect(figure.counts).toBe(false)
    expect(figureAt(figure, 0)).toBe('Dozens')
  })

  /** Counting these would show "12/7" and a year climbing from zero. */
  it('leaves figures that are not amounts still', () => {
    for (const [typed, lead] of [
      ['24/7 access', '24/7'],
      ['Since 1972', 'Since 1972'],
      ['Top 10 finish', 'Top 10'],
    ]) {
      const figure = splitFigure(typed)

      expect(figure.counts).toBe(false)
      expect(figureAt(figure, 0)).toBe(lead)
    }
  })
})

describe('figureAt', () => {
  it('starts at zero and lands on the figure as written', () => {
    const figure = splitFigure('$15,000 annually')

    expect(figureAt(figure, 0)).toBe('$0')
    expect(figureAt(figure, 1)).toBe('$15,000')
  })

  it('never shows a fraction the figure does not have', () => {
    expect(figureAt(splitFigure('7 active projects'), 0.5)).toMatch(/^\d$/)
  })

  it('keeps the decimals a figure has', () => {
    expect(figureAt(splitFigure('2.5 tonnes'), 1)).toBe('2.5')
  })
})
