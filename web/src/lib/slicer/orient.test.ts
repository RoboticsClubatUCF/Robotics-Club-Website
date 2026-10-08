import { describe, expect, it } from 'vitest'
import { autoOrient, fromVectors, layFlat, rotate } from './orient'
import { placedBox, placementAffine } from './plateTransform'

const id = { x: 100, y: 100, sx: 1, sy: 1, sz: 1 }

/** A slab 4 mm thick, modelled standing on its 4 × 40 edge. */
function standingSlab() {
  const [w, d, h] = [4, 40, 40]
  const v = [[0, 0, 0], [w, 0, 0], [w, d, 0], [0, d, 0], [0, 0, h], [w, 0, h], [w, d, h], [0, d, h]]
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]]
  return Float32Array.from(f.flatMap((tri) => tri.flatMap((i) => v[i]!)))
}

/** A T shape: a broad top on a narrow stem, so standing it upright needs support. */
function tee() {
  const parts: number[] = []
  const cuboid = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
    const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]
    const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]]
    parts.push(...f.flatMap((tri) => tri.flatMap((i) => v[i]!)))
  }
  cuboid(15, 15, 0, 25, 25, 30)
  cuboid(0, 0, 30, 40, 40, 36)
  return Float32Array.from(parts)
}

describe('fromVectors', () => {
  it('turns one direction onto another, including the opposite one', () => {
    for (const from of [[1, 0, 0], [0, 0, 1], [0, 0, -1], [0.6, 0.8, 0]] as [number, number, number][]) {
      const turned = rotate(fromVectors(from, [0, 0, -1]), from)
      expect(turned[0]).toBeCloseTo(0, 6)
      expect(turned[1]).toBeCloseTo(0, 6)
      expect(turned[2]).toBeCloseTo(-1, 6)
    }
  })
})

describe('layFlat', () => {
  it('puts the chosen face down, after the turn already there', () => {
    const q = layFlat({ qx: 0, qy: 0, qz: 0, qw: 1 }, [1, 0, 0])
    const down = rotate(q, [1, 0, 0])
    expect(down[2]).toBeCloseTo(-1, 6)
  })
})

describe('autoOrient', () => {
  it('lays a standing slab down on its broad face', () => {
    const positions = standingSlab()
    const q = autoOrient(positions)
    const box = placedBox(positions, placementAffine(positions, { ...id, ...q }))
    expect(box.max[2] - box.min[2]).toBeCloseTo(4, 3)
  })

  it('stands a T on its broad top rather than its stem', () => {
    const positions = tee()
    const q = autoOrient(positions)
    // Top down: the broad face is on the bed, so the stem points up.
    expect(rotate(q, [0, 0, 1])[2]).toBeCloseTo(-1, 3)
  })
})
