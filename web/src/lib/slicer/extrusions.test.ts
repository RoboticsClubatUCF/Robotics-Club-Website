import { describe, expect, it } from 'vitest'
import { fitsTexture } from './extrusions'
import { SEGMENTS_PER_ROW, SEGMENT_FLOATS } from './preview'

const rows = (n: number) => ({
  segments: new Float32Array(n * SEGMENTS_PER_ROW * SEGMENT_FLOATS),
  layerStart: new Uint32Array([0, n * SEGMENTS_PER_ROW]),
})

describe('fitsTexture', () => {
  it('fits a role whose rows and width the device can hold', () => {
    expect(fitsTexture(rows(1954), 8192)).toBe(true)
    expect(fitsTexture(rows(4096), 4096)).toBe(true)
  })

  it('refuses one too tall, or a device that can’t make the row width', () => {
    expect(fitsTexture(rows(4097), 4096)).toBe(false)
    expect(fitsTexture(rows(1), 2048)).toBe(false)
  })
})
