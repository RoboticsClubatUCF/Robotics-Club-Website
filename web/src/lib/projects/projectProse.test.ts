import { describe, expect, it } from 'vitest'
import { proseExcerpt, proseParagraphs } from './projectProse'

describe('proseParagraphs', () => {
  it('breaks on a blank line', () => {
    expect(proseParagraphs('One.\n\nTwo.')).toEqual(['One.', 'Two.'])
  })

  /**
   * A single newline is a wrapped line, not a new paragraph — which is what
   * somebody typing into a textarea produces without meaning anything by it.
   */
  it('leaves a single newline inside its paragraph', () => {
    expect(proseParagraphs('One,\nstill one.')).toEqual(['One,\nstill one.'])
  })

  it('treats a run of blank lines as one break', () => {
    expect(proseParagraphs('One.\n\n\n\nTwo.')).toEqual(['One.', 'Two.'])
  })

  /** Never an empty array: the caller maps over this and a project with one
      paragraph is the ordinary case, not a special one. */
  it('answers with the whole string when there is no break', () => {
    expect(proseParagraphs('Just the one.')).toEqual(['Just the one.'])
  })
})

describe('proseExcerpt', () => {
  it('runs the paragraphs together with a space', () => {
    expect(proseExcerpt('One.\n\nTwo.')).toBe('One. Two.')
  })

  /** Nothing is dropped — the clamp that shortens this is CSS, so the whole
      write-up stays in the DOM for anyone reading it aloud. */
  it('shortens nothing', () => {
    const long = 'A '.repeat(400).trim()
    expect(proseExcerpt(long)).toHaveLength(long.length)
  })

  it('passes null through rather than answering an empty string', () => {
    expect(proseExcerpt(null)).toBeNull()
  })
})
