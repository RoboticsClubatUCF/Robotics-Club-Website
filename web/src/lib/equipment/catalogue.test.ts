import { describe, expect, it } from 'vitest'
import { LIST_LIMIT, hits, narrow, showAllLabel } from './catalogue'

describe('hits', () => {
  const row = ['Rowan Chen', 'rowan_c', 'bracket-v2.stl']

  it('finds a person by either half of their name', () => {
    expect(hits(row, 'rowan')).toBe(true)
    expect(hits(row, 'chen')).toBe(true)
    expect(hits(row, 'CHEN')).toBe(true)
  })

  it('finds them by Discord handle or by file', () => {
    expect(hits(row, 'rowan_c')).toBe(true)
    expect(hits(row, 'bracket')).toBe(true)
    expect(hits(row, '.stl')).toBe(true)
  })

  /**
   * Every word has to land somewhere, in any field — so two facts about a row narrow it, and a
   * surname typed before a forename still works. A single substring across a joined string would
   * find "rowan chen" and not "chen rowan", which is a difference nobody can see and everybody
   * trips over.
   */
  it('takes the words in any order and across fields', () => {
    expect(hits(row, 'chen rowan')).toBe(true)
    expect(hits(row, 'rowan bracket')).toBe(true)
    expect(hits(row, 'rowan sprocket')).toBe(false)
  })

  it('matches everything on an empty or blank search', () => {
    expect(hits(row, '')).toBe(true)
    expect(hits(row, '   ')).toBe(true)
  })

  /** Or searching "null" would return everyone who never linked Discord. */
  it('does not turn a missing field into the word null', () => {
    expect(hits(['Sam Okafor', null, undefined], 'null')).toBe(false)
    expect(hits(['Sam Okafor', null, undefined], 'okafor')).toBe(true)
  })
})

/**
 * Search then cut, in that order — which is the only decision in here worth a
 * test, and the one that is easy to get backwards.
 */

const shelf = (...names: string[]) =>
  names.map((name) => ({ name, description: null }))

describe('narrow', () => {
  it('opens with the first few and counts what is hidden', () => {
    const items = shelf('a', 'b', 'c', 'd', 'e', 'f', 'g')

    expect(narrow(items, '', false)).toMatchObject({
      matched: 7,
      hidden: 7 - LIST_LIMIT,
    })
    expect(narrow(items, '', false).shown).toHaveLength(LIST_LIMIT)
    expect(narrow(items, '', true).shown).toHaveLength(7)
  })

  it('hides nothing when the list is short enough to show', () => {
    expect(narrow(shelf('a', 'b'), '', false)).toMatchObject({
      hidden: 0,
      matched: 2,
    })
  })

  /**
   * The order that matters. Searching "drill" and being shown five of the
   * eleven matches is useful; being shown whichever matches happened to fall
   * in the first five rows of the whole inventory is not.
   */
  it('searches the whole list before cutting it, not the other way round', () => {
    const items = [
      ...shelf('Anvil', 'Bandsaw', 'Calipers', 'Chisel', 'Clamp'),
      { name: 'Cordless drill', description: null },
    ]

    const found = narrow(items, 'drill', false)

    expect(found.shown.map((item) => item.name)).toEqual(['Cordless drill'])
    expect(found.matched).toBe(1)
    expect(found.hidden).toBe(0)
  })

  it('searches the description as well as the name', () => {
    const items = [
      { name: 'Cordless drill', description: 'Battery and charger in the case.' },
      { name: 'Heat gun', description: null },
    ]

    expect(narrow(items, 'charger', false).shown.map((i) => i.name)).toEqual([
      'Cordless drill',
    ])
  })

  it('ignores case and surrounding space', () => {
    const items = shelf('Cordless drill')

    expect(narrow(items, '  DRILL ', false).matched).toBe(1)
  })
})

describe('showAllLabel', () => {
  it('says how many more there are, then how to go back', () => {
    expect(showAllLabel(3, false)).toBe('SHOW ALL — 3 MORE')
    expect(showAllLabel(3, true)).toBe('SHOW FEWER')
  })
})
