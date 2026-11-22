import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import type { Affine } from './plateTransform.js'
import { hasPreview } from './printThumbnail.js'
import { renderThumbnail } from './thumbnailRender.js'

const IDENTITY: Affine = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] }

/** A closed 10 mm cube, twelve triangles. */
function cube(): Float32Array {
  const c = [
    [0, 0, 0],
    [10, 0, 0],
    [10, 10, 0],
    [0, 10, 0],
    [0, 0, 10],
    [10, 0, 10],
    [10, 10, 10],
    [0, 10, 10],
  ]
  const faces = [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4],
    [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
  ]
  return Float32Array.from(faces.flat().flatMap((index) => c[index]!))
}

/** The RGBA pixels of a PNG this module wrote: one IDAT, filter 0. */
function pixels(png: Uint8Array) {
  const bytes = Buffer.from(png)
  const size = bytes.readUInt32BE(16)
  const length = bytes.readUInt32BE(33)
  const rows = inflateSync(bytes.subarray(41, 41 + length))
  return { size, alpha: (x: number, y: number) => rows[y * (size * 4 + 1) + 1 + x * 4 + 3]! }
}

describe('renderThumbnail', () => {
  it('draws the part on a transparent background', async () => {
    const png = renderThumbnail([{ positions: cube(), affines: [IDENTITY] }], 64)

    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    const { size, alpha } = pixels(png)
    expect(size).toBe(64)
    expect(alpha(32, 32)).toBe(255)
    expect(alpha(0, 0)).toBe(0)
  })

  it('frames a tiny part as large as a big one', async () => {
    const small: Affine = { m: [0.01, 0, 0, 0, 0.01, 0, 0, 0, 0.01], t: [5, 5, 0] }
    const { alpha } = pixels(renderThumbnail([{ positions: cube(), affines: [small] }], 64))
    expect(alpha(32, 32)).toBe(255)
  })
})

describe('hasPreview', () => {
  const model = { id: 'm', fileName: 'a.stl', fileId: 'f', meshFileId: null }
  const plate = { fileId: null, fileName: 'a.stl', slicedWith: {}, models: [model], objects: [{ modelId: 'm' }] }
  const upload = { fileId: 'f', fileName: 'a.stl', slicedWith: null, models: [], objects: [] }

  it('takes an STL upload or a plate with meshes', () => {
    expect(hasPreview(upload)).toBe(true)
    expect(hasPreview(plate)).toBe(true)
  })

  it('takes a STEP once the worker has meshed it', () => {
    const step = { ...model, fileName: 'a.step' }
    expect(hasPreview({ ...plate, models: [step] })).toBe(false)
    expect(hasPreview({ ...plate, models: [{ ...step, meshFileId: 'mesh' }] })).toBe(true)
  })

  it('has nothing to draw for a resin STEP or a settled print', () => {
    expect(hasPreview({ ...upload, fileName: 'a.step' })).toBe(false)
    expect(hasPreview({ ...upload, fileId: null })).toBe(false)
    expect(hasPreview({ ...plate, models: [{ ...model, fileId: null }] })).toBe(false)
  })
})
