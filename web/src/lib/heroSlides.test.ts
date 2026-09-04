import { afterEach, describe, expect, it, vi } from 'vitest'
import { inHeroWindow, prefersReducedMotion, stepIndex } from './heroSlides'

/**
 * The two functions the front page's slideshow is built out of, without a DOM.
 *
 * Both differ from the project gallery's version in the same way — they wrap — and both are total,
 * because the officer desk renders the same component against a list it is editing: a photograph
 * removed under the index must not be able to put `NaN` into a style or an undefined slide on the
 * page.
 */

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('stepIndex', () => {
  it('wraps at both ends', () => {
    expect(stepIndex(0, 1, 3)).toBe(1)
    expect(stepIndex(2, 1, 3)).toBe(0)
    expect(stepIndex(0, -1, 3)).toBe(2)
  })

  it('answers 0 for an empty list rather than NaN', () => {
    expect(stepIndex(0, 1, 0)).toBe(0)
    expect(stepIndex(3, -1, 0)).toBe(0)
  })

  it('brings an index that has fallen off the end back into range', () => {
    // The list shrank under a delete on the officer desk. Clamping happens on
    // read in the component; this is the other half of never rendering a hole.
    expect(stepIndex(9, 0, 3)).toBe(0)
    expect(stepIndex(-4, 0, 3)).toBe(2)
  })
})

describe('inHeroWindow', () => {
  it('mounts the current slide and its two neighbours', () => {
    expect([0, 1, 2, 3, 4].map((at) => inHeroWindow(at, 2, 5))).toEqual([
      false,
      true,
      true,
      true,
      false,
    ])
  })

  /**
   * The whole reason this is not `projectGallery.ts`'s version. On the last
   * slide the *first* one is next, and a window that measured the long way round
   * would leave the transition every visitor who stays sees to a download that
   * starts as it begins.
   */
  it('measures the short way round, so the ends are neighbours', () => {
    expect(inHeroWindow(0, 4, 5)).toBe(true)
    expect(inHeroWindow(4, 0, 5)).toBe(true)
    expect(inHeroWindow(2, 0, 5)).toBe(false)
  })

  it('mounts everything in a list too short to have a far side', () => {
    expect([0, 1].map((at) => inHeroWindow(at, 0, 2))).toEqual([true, true])
    expect(inHeroWindow(0, 0, 1)).toBe(true)
  })

  it('mounts nothing at all when there is nothing', () => {
    expect(inHeroWindow(0, 0, 0)).toBe(false)
  })
})

describe('prefersReducedMotion', () => {
  it('is what the browser says', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({ matches: query.includes('reduce') })),
    )

    expect(prefersReducedMotion()).toBe(true)
  })

  /**
   * A browser too old for `matchMedia` — or a test environment — answers no
   * rather than throwing. The site's global reduced-motion block flattens the
   * fade either way, so the worst an unanswerable query costs is a slideshow
   * that advances without animating.
   */
  it('answers no where the question cannot be asked', () => {
    vi.stubGlobal('matchMedia', undefined)

    expect(prefersReducedMotion()).toBe(false)
  })
})
