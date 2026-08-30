import { describe, expect, it } from 'vitest'
import type { ApiProjectImage } from '../api/api'
import { DEFAULT_FRAMING } from '../media/imageFraming'
import { counterLabel, inWindow, moveItem, slidesOf } from './projectGallery'

const image = (id: string): ApiProjectImage => ({
  id,
  url: `/api/files/${id}`,
  caption: null,
  ...DEFAULT_FRAMING,
})

describe('slidesOf', () => {
  it('shows the gallery when there is one', () => {
    const slides = slidesOf({
      images: [image('a'), image('b')],
      coverUrl: 'https://example.test/cover.png',
    })

    expect(slides.map((slide) => slide.id)).toEqual(['a', 'b'])
  })

  /** The old single cover is not lost — it becomes the one slide. */
  it('falls back to the cover when the gallery is empty', () => {
    const slides = slidesOf({
      images: [],
      coverUrl: 'https://example.test/cover.png',
    })

    expect(slides).toEqual([
      {
        id: 'cover',
        url: 'https://example.test/cover.png',
        caption: null,
        // Centred: a cover has no row to hold a framing on.
        ...DEFAULT_FRAMING,
      },
    ])
  })

  it('has nothing to show when there is neither', () => {
    expect(slidesOf({ images: [], coverUrl: null })).toEqual([])
  })
})

describe('inWindow', () => {
  /**
   * The current slide and its two neighbours, and nothing else. This is the
   * whole loading strategy — `loading="lazy"` cannot do it, because absolutely
   * stacked slides are all inside the viewport as far as the browser is
   * concerned.
   */
  it('mounts the current slide and one either side', () => {
    expect([0, 1, 2, 3, 4].filter((index) => inWindow(index, 2))).toEqual([1, 2, 3])
  })

  it('does not run off the front', () => {
    expect([0, 1, 2, 3].filter((index) => inWindow(index, 0))).toEqual([0, 1])
  })
})

describe('counterLabel', () => {
  /** Zero-padded so the line does not change width as it counts. */
  it('pads both halves', () => {
    expect(counterLabel(0, 7)).toBe('01 / 07')
    expect(counterLabel(9, 12)).toBe('10 / 12')
  })
})

describe('moveItem', () => {
  it('moves an item later and earlier', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
  })

  it('never mutates the list it was given', () => {
    const items = ['a', 'b', 'c']
    moveItem(items, 0, 2)
    expect(items).toEqual(['a', 'b', 'c'])
  })

  /**
   * Total rather than throwing, so the buttons that call it do not have to
   * duplicate their own disabled state in a guard.
   */
  it('returns the list untouched for a move that goes nowhere or off the end', () => {
    expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b'])
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b'])
    expect(moveItem(['a', 'b'], 0, 5)).toEqual(['a', 'b'])
    expect(moveItem(['a', 'b'], 9, 0)).toEqual(['a', 'b'])
  })
})
