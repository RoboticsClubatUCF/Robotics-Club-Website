import { describe, expect, it } from 'vitest'
import { arrange, freeSpot } from './arrange'
import { fitOn, boxOn } from './plate'

const bed = { width: 256, depth: 256, height: 256, exclude: { minX: 246, minY: 0, maxX: 256, maxY: 20 } }
const id = { qx: 0, qy: 0, qz: 0, qw: 1, sx: 1, sy: 1, sz: 1 }

function box(w: number, d: number, h: number) {
  const v = [[0, 0, 0], [w, 0, 0], [w, d, 0], [0, d, 0], [0, 0, h], [w, 0, h], [w, d, h], [0, d, h]]
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]]
  return Float32Array.from(f.flatMap((t) => t.flatMap((i) => v[i]!)))
}

const overlap = (a: ReturnType<typeof boxOn>, b: ReturnType<typeof boxOn>) =>
  a.min[0] < b.max[0] && b.min[0] < a.max[0] && a.min[1] < b.max[1] && b.min[1] < a.max[1]

describe('arrange', () => {
  it('lays copies out on the bed, apart, and clear of the purge corner', () => {
    const cube = box(40, 40, 20)
    const items = Array.from({ length: 12 }, (_, i) => ({ id: `c${String(i)}`, positions: cube, placement: { ...id, x: 128, y: 128 } }))
    const { placed, unplaced } = arrange(items, bed)
    expect(unplaced).toEqual([])
    const boxes = items.map((item) => {
      const at = { ...item.placement, ...placed.get(item.id)! }
      expect(fitOn(cube, at, bed)).toBeNull()
      return boxOn(cube, at)
    })
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i]!, boxes[j]!)).toBe(false)
    }
  })

  it('leaves out what doesn’t fit, and says which', () => {
    const big = box(120, 120, 10)
    const items = Array.from({ length: 5 }, (_, i) => ({ id: `b${String(i)}`, positions: big, placement: { ...id, x: 128, y: 128 } }))
    const { placed, unplaced } = arrange(items, bed)
    expect(placed.size + unplaced.length).toBe(5)
    expect(unplaced.length).toBeGreaterThan(0)
  })
})

describe('freeSpot', () => {
  it('finds room beside what’s there, nearest the middle', () => {
    const cube = box(40, 40, 20)
    const taken = [boxOn(cube, { ...id, x: 128, y: 128 })]
    const spot = freeSpot(taken, { w: 40, d: 40 }, bed)
    expect(overlap(boxOn(cube, { ...id, ...spot }), taken[0]!)).toBe(false)
    expect(Math.hypot(spot.x - 128, spot.y - 128)).toBeLessThan(60)
  })
})
