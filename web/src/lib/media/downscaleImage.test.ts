import { describe, expect, it } from 'vitest'
import { MAX_EDGE, downscaleImage, fitWithin } from './downscaleImage'

describe('fitWithin', () => {
  it('scales a landscape photo down by its long edge', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1920, height: 1440 })
  })

  it('scales a portrait photo down by its long edge', () => {
    expect(fitWithin(3000, 4000)).toEqual({ width: 1440, height: 1920 })
  })

  it('scales a square photo down to a square', () => {
    expect(fitWithin(4000, 4000)).toEqual({ width: MAX_EDGE, height: MAX_EDGE })
  })

  /** Never upscales — a small picture made bigger is a blurry small picture. */
  it('leaves anything already inside the box alone', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(1920, 1080)).toEqual({ width: 1920, height: 1080 })
  })

  /** A zero-height canvas throws, so a wild aspect ratio floors at one pixel. */
  it('keeps at least one pixel on the short edge of a panorama', () => {
    expect(fitWithin(40_000, 3)).toEqual({ width: MAX_EDGE, height: 1 })
  })

  it('does not divide by zero on an empty image', () => {
    expect(fitWithin(0, 0)).toEqual({ width: 0, height: 0 })
  })
})

describe('downscaleImage', () => {
  /**
   * jsdom cannot decode an image at all — `<img>` fires neither `onload` nor `onerror` for a blob
   * URL, so this is the hang the decode timeout exists for, and it resolves rather than sitting
   * there. That is the point twice over: it is what a browser that cannot decode gets, and it is
   * what makes the whole upload path testable here without a canvas shim.
   *
   * Real timers, and a timeout past `DECODE_TIMEOUT_MS` — under fake timers this would need
   * advancing by hand, and testing.md is clear about mixing those with async waits.
   */
  it('hands back the original file when it cannot decode', async () => {
    const original = new File([new Uint8Array(2_000_000)], 'photo.jpg', {
      type: 'image/jpeg',
    })

    const result = await downscaleImage(original)

    expect(result.file).toBe(original)
    expect(result.downscaled).toBe(false)
  }, 10_000)

  it('does not touch a file that is already small', async () => {
    const original = new File([new Uint8Array(1024)], 'icon.png', {
      type: 'image/png',
    })

    const result = await downscaleImage(original)

    expect(result.file).toBe(original)
    expect(result.downscaled).toBe(false)
  })

  /** Flattening one to its first frame is a worse outcome than a big file. */
  it('leaves an animated GIF alone', async () => {
    const original = new File([new Uint8Array(4_000_000)], 'spin.gif', {
      type: 'image/gif',
    })

    expect((await downscaleImage(original)).downscaled).toBe(false)
  })
})
