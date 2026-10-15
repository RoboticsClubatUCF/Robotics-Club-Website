import { describe, expect, it } from 'vitest'
import { overhangOn } from './plate'

const at = { x: 100, y: 100, sx: 1, sy: 1, sz: 1 }
const upright = { qx: 0, qy: 0, qz: 0, qw: 1 }
const flipped = { qx: 1, qy: 0, qz: 0, qw: 0 }

const BOX_FACES = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]]

/** A square `base` mm across, widening to `top` mm across `height` mm up. */
function frustum(base: number, top: number, height: number) {
  const [b, t] = [base / 2, top / 2]
  const v = [[-b, -b, 0], [b, -b, 0], [b, b, 0], [-b, b, 0], [-t, -t, height], [t, -t, height], [t, t, height], [-t, t, height]]
  return Float32Array.from(BOX_FACES.flatMap((tri) => tri.flatMap((i) => v[i]!)))
}

/** Its sides are 18° from flat, so all but the base's 10 × 10 needs holding up. */
const cap = frustum(10, 40, 5)

/** A ramp whose underside rises 45° from the plate's edge. */
function ramp() {
  const v = [[0, 0, 0], [20, 0, 0], [20, 10, 0], [0, 10, 0], [0, 0, 20], [20, 0, 20], [20, 10, 20], [0, 10, 20], [0, 30, 20], [20, 30, 20]]
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [7, 6, 9], [7, 9, 8], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 9, 6], [3, 0, 4], [3, 4, 7], [3, 7, 8], [2, 3, 8], [2, 8, 9]]
  return Float32Array.from(f.flatMap((tri) => tri.flatMap((i) => v[i]!)))
}

describe('overhangOn', () => {
  it('counts the underside off the bed, seen from below', () => {
    expect(overhangOn(cap, { ...at, ...upright }, 30)).toBeCloseTo(40 * 40 - 10 * 10, 3)
  })

  it('counts nothing on the bed', () => {
    expect(overhangOn(cap, { ...at, ...flipped }, 30)).toBe(0)
    expect(overhangOn(frustum(20, 20, 20), { ...at, ...upright }, 30)).toBe(0)
  })

  it('leaves a slope steeper than the threshold to print on its own', () => {
    expect(overhangOn(ramp(), { ...at, ...upright }, 30)).toBe(0)
    expect(overhangOn(ramp(), { ...at, ...upright }, 50)).toBeGreaterThan(0)
  })

  it('reads a threshold of 0, where Orca decides itself, as its default of 30', () => {
    expect(overhangOn(ramp(), { ...at, ...upright }, 0)).toBe(0)
    expect(overhangOn(cap, { ...at, ...upright }, 0)).toBeCloseTo(1500, 3)
  })

  it('follows the scale', () => {
    expect(overhangOn(cap, { ...at, ...upright, sx: 2 }, 30)).toBeCloseTo(2 * 1500, 3)
  })
})
