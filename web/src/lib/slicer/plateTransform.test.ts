import { describe, expect, it } from 'vitest'
import raw from './fixtures/plateTransform.vectors.json?raw'
import { fitOn } from './plate'
import { type Placement, fitProblem, placedBox, placementAffine } from './plateTransform'

// Shared with server/src/printing/plateTransform.test.ts: the worker writes these placements into
// the project Orca slices, so the plate drawn here has to be the plate printed.
interface Vector {
  name: string
  mesh: number[]
  placement: Placement
  expected: { m: number[]; t: number[]; min: number[]; max: number[]; fit: string | null }
}

const vectors = JSON.parse(raw) as {
  bed: { width: number; depth: number; height: number; exclude: { minX: number; minY: number; maxX: number; maxY: number } }
  cases: Vector[]
}

describe('placementAffine', () => {
  it.each(vectors.cases)('$name', ({ mesh, placement, expected }) => {
    const positions = Float32Array.from(mesh)
    const affine = placementAffine(positions, placement)
    affine.m.forEach((value, i) => expect(value).toBeCloseTo(expected.m[i]!, 6))
    affine.t.forEach((value, i) => expect(value).toBeCloseTo(expected.t[i]!, 6))
    const box = placedBox(positions, affine)
    box.min.forEach((value, i) => expect(value).toBeCloseTo(expected.min[i]!, 4))
    box.max.forEach((value, i) => expect(value).toBeCloseTo(expected.max[i]!, 4))
    expect(fitProblem(positions, affine, vectors.bed)).toBe(expected.fit)
  })
})

describe('fitOn', () => {
  it('gives the same answer as the uncached check, before and after a move', () => {
    for (const { mesh, placement, expected } of vectors.cases) {
      const positions = Float32Array.from(mesh)
      expect(fitOn(positions, placement, vectors.bed)).toBe(expected.fit)
      const moved = { ...placement, x: placement.x + 3, y: placement.y - 2 }
      expect(fitOn(positions, moved, vectors.bed)).toBe(
        fitProblem(positions, placementAffine(positions, moved), vectors.bed),
      )
    }
  })
})
