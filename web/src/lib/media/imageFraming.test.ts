import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FRAMING,
  MAX_ZOOM,
  frameStyle,
  isDefaultFraming,
  panBy,
  safeFraming,
  zoomTo,
} from './imageFraming'

describe('safeFraming', () => {
  it('passes sensible values through', () => {
    expect(safeFraming({ focalX: 25, focalY: 75, zoom: 2 })).toEqual({
      focalX: 25,
      focalY: 75,
      zoom: 2,
    })
  })

  it('centres anything missing', () => {
    expect(safeFraming(null)).toEqual(DEFAULT_FRAMING)
    expect(safeFraming({})).toEqual(DEFAULT_FRAMING)
    expect(safeFraming({ focalX: 10 })).toEqual({ ...DEFAULT_FRAMING, focalX: 10 })
  })

  /**
   * These numbers come out of a database column, so a row edited by hand in Studio can hold
   * anything. `NaN` in a style silently blanks a picture on the public page, which is worse than
   * ignoring the value.
   */
  it('refuses to put nonsense into a style', () => {
    expect(safeFraming({ focalX: NaN, focalY: Infinity, zoom: NaN })).toEqual(
      DEFAULT_FRAMING,
    )
    expect(
      safeFraming({ focalX: 'left' as unknown as number, zoom: null as unknown as number }),
    ).toEqual(DEFAULT_FRAMING)
  })

  it('clamps to the frame and to the zoom range', () => {
    expect(safeFraming({ focalX: -40, focalY: 400, zoom: 99 })).toEqual({
      focalX: 0,
      focalY: 100,
      zoom: MAX_ZOOM,
    })
    expect(safeFraming({ zoom: 0.2 }).zoom).toBe(1)
  })
})

describe('frameStyle', () => {
  it('covers and positions from the focal point', () => {
    expect(frameStyle({ focalX: 20, focalY: 80, zoom: 1 })).toEqual({
      objectFit: 'cover',
      objectPosition: '20% 80%',
    })
  })

  /** Origin pinned to the same point, or zooming drags the subject out of shot. */
  it('scales about the focal point', () => {
    expect(frameStyle({ focalX: 20, focalY: 80, zoom: 2 })).toEqual({
      objectFit: 'cover',
      objectPosition: '20% 80%',
      transform: 'scale(2)',
      transformOrigin: '20% 80%',
    })
  })

  /** No transform at all at 1×, so an unframed picture cannot pick up
      whatever resampling an engine applies to a transformed one. */
  it('writes no transform when nothing is zoomed', () => {
    expect(frameStyle(DEFAULT_FRAMING).transform).toBeUndefined()
  })

  it('never emits NaN, whatever it is given', () => {
    const style = frameStyle({ focalX: NaN, focalY: NaN, zoom: NaN })
    expect(JSON.stringify(style)).not.toContain('NaN')
  })
})

describe('panBy', () => {
  /** The picture follows the pointer, so the focal point moves against it. */
  it('moves the picture with the drag', () => {
    const panned = panBy(DEFAULT_FRAMING, 20, 10, 200, 100)
    expect(panned.focalX).toBe(40)
    expect(panned.focalY).toBe(40)
  })

  it('stops at the edges of the picture', () => {
    expect(panBy(DEFAULT_FRAMING, 10_000, 0, 200, 100).focalX).toBe(0)
    expect(panBy(DEFAULT_FRAMING, -10_000, 0, 200, 100).focalX).toBe(100)
  })

  /**
   * At 3× the same drag crosses three times as much picture, so the step is
   * divided by the zoom — otherwise the image tears away from the cursor
   * exactly when somebody is trying to be precise.
   */
  it('moves less when zoomed in', () => {
    const at1 = panBy({ ...DEFAULT_FRAMING, zoom: 1 }, 20, 0, 200, 100)
    const at2 = panBy({ ...DEFAULT_FRAMING, zoom: 2 }, 20, 0, 200, 100)

    expect(50 - at1.focalX).toBe(10)
    expect(50 - at2.focalX).toBe(5)
  })

  /** jsdom reports every rectangle as 0×0, and a divide would give Infinity. */
  it('does nothing against a frame with no size', () => {
    expect(panBy(DEFAULT_FRAMING, 20, 20, 0, 0)).toEqual(DEFAULT_FRAMING)
  })
})

describe('zoomTo', () => {
  it('clamps and rounds to the slider step', () => {
    expect(zoomTo(DEFAULT_FRAMING, 2.4567).zoom).toBe(2.46)
    expect(zoomTo(DEFAULT_FRAMING, 0).zoom).toBe(1)
    expect(zoomTo(DEFAULT_FRAMING, 100).zoom).toBe(MAX_ZOOM)
  })

  it('leaves the focal point where it was', () => {
    const framed = { focalX: 20, focalY: 80, zoom: 1 }
    expect(zoomTo(framed, 3)).toEqual({ focalX: 20, focalY: 80, zoom: 3 })
  })
})

describe('isDefaultFraming', () => {
  it('knows whether anybody has actually framed this', () => {
    expect(isDefaultFraming(DEFAULT_FRAMING)).toBe(true)
    expect(isDefaultFraming(null)).toBe(true)
    expect(isDefaultFraming({ focalX: 20, focalY: 50, zoom: 1 })).toBe(false)
    expect(isDefaultFraming({ focalX: 50, focalY: 50, zoom: 1.5 })).toBe(false)
  })
})
