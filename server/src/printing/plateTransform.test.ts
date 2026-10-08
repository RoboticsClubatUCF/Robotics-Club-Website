import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  applyAffine,
  canonicalQuat,
  convexHull,
  fitProblem,
  hullTouchesRect,
  placedBox,
  placementAffine,
} from './plateTransform.js'

interface Vector {
  name: string
  mesh: number[]
  placement: {
    x: number
    y: number
    qx: number
    qy: number
    qz: number
    qw: number
    sx: number
    sy: number
    sz: number
  }
  expected: { m: number[]; t: number[]; min: number[]; max: number[]; fit: string | null }
}

const vectors = JSON.parse(
  readFileSync(
    new URL('./fixtures/plateTransform.vectors.json', import.meta.url),
    'utf8',
  ),
) as {
  bed: {
    width: number
    depth: number
    height: number
    exclude: { minX: number; minY: number; maxX: number; maxY: number }
  }
  cases: Vector[]
}

// Shared with web/src/lib/slicer/plateTransform.test.ts: the workspace draws what this computes,
// and the worker writes it into the project Orca slices.
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

  it('sits every object on the bed with its box centred on the placement', () => {
    for (const { mesh, placement } of vectors.cases) {
      const positions = Float32Array.from(mesh)
      const box = placedBox(positions, placementAffine(positions, placement))
      expect(box.min[2]).toBeCloseTo(0, 6)
      expect((box.min[0] + box.max[0]) / 2).toBeCloseTo(placement.x, 4)
      expect((box.min[1] + box.max[1]) / 2).toBeCloseTo(placement.y, 4)
    }
  })

  it('lands the lowest vertex on the bed after a turn, not a corner of the old box', () => {
    // A tetrahedron tipped over: its old box corner would sit below the bed.
    const positions = Float32Array.from([
      0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 0, 0, 10, 0, 0, 0, 10,
    ])
    const s = Math.SQRT1_2
    const affine = placementAffine(positions, {
      x: 50,
      y: 50,
      qx: s,
      qy: 0,
      qz: 0,
      qw: s,
      sx: 1,
      sy: 1,
      sz: 1,
    })
    const lowest = Math.min(
      ...[0, 3, 6, 9, 12, 15].map(
        (i) =>
          applyAffine(affine, positions[i]!, positions[i + 1]!, positions[i + 2]!)[2],
      ),
    )
    expect(lowest).toBeCloseTo(0, 6)
  })
})

describe('canonicalQuat', () => {
  it('spells q and -q the same', () => {
    expect(canonicalQuat({ qx: 0, qy: 0, qz: -0.6, qw: -0.8 })).toEqual(
      canonicalQuat({ qx: 0, qy: 0, qz: 0.6, qw: 0.8 }),
    )
  })

  it('falls back to no turn for a zero quaternion', () => {
    expect(canonicalQuat({ qx: 0, qy: 0, qz: 0, qw: 0 })).toEqual({
      qx: 0,
      qy: 0,
      qz: 0,
      qw: 1,
    })
  })
})

describe('hullTouchesRect', () => {
  const rect = { minX: 0, minY: 0, maxX: 10, maxY: 10 }

  it('sees overlap, and a diamond whose box overlaps but whose shape does not', () => {
    expect(
      hullTouchesRect(
        convexHull([
          [5, 5],
          [15, 5],
          [15, 15],
          [5, 15],
        ]),
        rect,
      ),
    ).toBe(true)
    expect(
      hullTouchesRect(
        convexHull([
          [16, 10],
          [21, 15],
          [16, 20],
          [11, 15],
        ]),
        rect,
      ),
    ).toBe(false)
    expect(
      hullTouchesRect(
        convexHull([
          [11, 0],
          [20, 0],
          [20, 5],
        ]),
        rect,
      ),
    ).toBe(false)
  })
})
