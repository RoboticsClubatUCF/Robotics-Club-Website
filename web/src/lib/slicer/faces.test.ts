import { describe, expect, it } from 'vitest'
import { restingFaces } from './faces'

type V = [number, number, number]

const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** Two triangles for a quad given in order round its edge, wound to face `out`. */
function quad(a: V, b: V, c: V, d: V, out: V): number[] {
  const facing = dot(cross(sub(b, a), sub(c, a)), out) > 0
  return (facing ? [a, b, c, a, c, d] : [a, c, b, a, d, c]).flat()
}

function box([x0, y0, z0]: V, [x1, y1, z1]: V): number[] {
  return [
    ...quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1]),
    ...quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]),
    ...quad([x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [-1, 0, 0]),
    ...quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0]),
    ...quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]),
    ...quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0]),
  ]
}

/** Each face as "normal: area", rounded, in a stable order. */
const summary = (positions: number[]) =>
  restingFaces(new Float32Array(positions))
    .map((face) => `${face.normal.map((v) => Math.round(v)).join(',')}: ${String(Math.round(face.area))}`)
    .sort()

describe('restingFaces', () => {
  it('offers all six sides of a box', () => {
    const faces = restingFaces(new Float32Array(box([0, 0, 0], [20, 30, 10])))
    expect(faces).toHaveLength(6)
    expect(summary(box([0, 0, 0], [20, 30, 10]))).toEqual([
      '-1,0,0: 300',
      '0,-1,0: 200',
      '0,0,-1: 600',
      '0,0,1: 600',
      '0,1,0: 200',
      '1,0,0: 300',
    ])
    // Two triangles per side, nine floats each, and four edges round it: not the diagonal.
    for (const face of faces) {
      expect(face.positions).toHaveLength(18)
      expect(face.outline).toHaveLength(4 * 6)
    }
  })

  it('leaves out faces something else sticks out past, and joins coplanar ones', () => {
    // A step: a 20 × 20 × 10 block with a 10 × 20 × 10 block on its left half.
    const step = [...box([0, 0, 0], [20, 20, 10]), ...box([0, 0, 10], [10, 20, 20])]
    expect(summary(step)).toEqual([
      // The left side is both blocks' left faces, one plane.
      '-1,0,0: 400',
      // Front and back are L-shaped: both blocks' faces again.
      '0,-1,0: 300',
      '0,0,-1: 400',
      // Only the upper block's top; the lower one's has the upper block above it.
      '0,0,1: 200',
      '0,1,0: 300',
      '1,0,0: 200',
    ])
  })

  it('offers a table’s four leg bottoms as one face', () => {
    const legs = [
      [0, 0],
      [40, 0],
      [0, 40],
      [40, 40],
    ].flatMap(([x, y]) => box([x!, y!, 0], [x! + 5, y! + 5, 30]))
    const table = [...legs, ...box([0, 0, 30], [45, 45, 33])]
    const bottom = restingFaces(new Float32Array(table)).find((face) => face.normal[2] < -0.99)!
    expect(bottom.area).toBeCloseTo(100)
    expect(bottom.positions).toHaveLength(4 * 18)
  })

  it('still finds the faces of a file saved inside out', () => {
    const inverted = box([0, 0, 0], [10, 10, 10])
    for (let i = 0; i < inverted.length; i += 9) {
      // Swap each triangle's second and third corners.
      for (let k = 0; k < 3; k++) {
        const second = inverted[i + 3 + k]!
        inverted[i + 3 + k] = inverted[i + 6 + k]!
        inverted[i + 6 + k] = second
      }
    }
    const faces = restingFaces(new Float32Array(inverted))
    expect(faces).toHaveLength(6)
    // Facing outwards all the same: the bottom one points down.
    expect(faces.some((face) => face.normal[2] < -0.99)).toBe(true)
  })

  it('offers nothing on a smooth sphere', () => {
    const positions: number[] = []
    const steps = 64
    const at = (i: number, j: number): V => {
      const theta = (i / steps) * Math.PI
      const phi = (j / steps) * 2 * Math.PI
      return [10 * Math.sin(theta) * Math.cos(phi), 10 * Math.sin(theta) * Math.sin(phi), 10 * Math.cos(theta)]
    }
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < steps; j++) {
        positions.push(...at(i, j), ...at(i + 1, j), ...at(i + 1, j + 1))
        positions.push(...at(i, j), ...at(i + 1, j + 1), ...at(i, j + 1))
      }
    }
    expect(restingFaces(new Float32Array(positions))).toEqual([])
  })

  it('works a mesh out once', () => {
    const positions = new Float32Array(box([0, 0, 0], [5, 5, 5]))
    expect(restingFaces(positions)).toBe(restingFaces(positions))
  })
})
