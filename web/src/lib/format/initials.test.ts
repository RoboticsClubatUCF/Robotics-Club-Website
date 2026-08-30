import { describe, expect, it } from 'vitest'
import { initialsOf } from './initials'

/**
 * The avatar's fallback. Worth its own test because `fullName` is one free-text
 * column that everything from the signup form to an officer's typing lands in,
 * and the failure mode is a blank square in the top corner of every page.
 */
describe('initialsOf', () => {
  it('takes the first and last name', () => {
    expect(initialsOf('Rowan Test')).toBe('RT')
  })

  /** Middle names and particles are skipped — two characters is what fits. */
  it('ignores everything between them', () => {
    expect(initialsOf('Ada Grace King Lovelace')).toBe('AL')
    expect(initialsOf('Ludwig van Beethoven')).toBe('LB')
  })

  it('manages a single name', () => {
    expect(initialsOf('Knightro')).toBe('K')
  })

  it('is not thrown by whatever whitespace it is given', () => {
    expect(initialsOf('  rowan   test  ')).toBe('RT')
    expect(initialsOf('\tRowan\nTest')).toBe('RT')
  })

  /**
   * A first letter outside the basic plane is a surrogate pair, and indexing
   * one splits it into half a character that renders as a replacement box.
   */
  it('keeps a character that takes two code units whole', () => {
    expect(initialsOf('𝒜da 𝔏ovelace')).toBe('𝒜𝔏')
  })

  /** Never empty: a blank avatar reads as a rendering bug, not as missing data. */
  it('has something to draw even for a name that is not there', () => {
    expect(initialsOf('')).toBe('?')
    expect(initialsOf('   ')).toBe('?')
  })
})
