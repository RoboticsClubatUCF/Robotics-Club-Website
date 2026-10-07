/**
 * Where an object sits on the plate, as the workspace and the slicer worker both compute it.
 *
 * The contract: scale the mesh along its own axes and turn it about the centre of its bounding
 * box, put that centre at (x, y) in plate millimetres, then lower it until its lowest vertex is at
 * z = 0. Height is never stored, so an object can't float or sink. The web package has a copy in
 * `web/src/lib/slicer/plateTransform.ts`; both are tested against `plateTransform.vectors.json`.
 *
 * Pure arithmetic on flat arrays, so the browser can run it without three.js and the worker without
 * a browser.
 */

export interface Placement {
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

export interface Box {
  min: [number, number, number]
  max: [number, number, number]
}

export interface Bed {
  width: number
  depth: number
  height: number
  exclude: { minX: number; minY: number; maxX: number; maxY: number } | null
}

/** A 3×3 rotation-and-scale part plus a translation: world = m·v + t. Row-major. */
export interface Affine {
  m: [number, number, number, number, number, number, number, number, number]
  t: [number, number, number]
}

export const MIN_SCALE = 0.1
export const MAX_SCALE = 5

/** Unit length, and w ≥ 0, so one turn always has one spelling. */
export function canonicalQuat(q: { qx: number; qy: number; qz: number; qw: number }) {
  const length = Math.hypot(q.qx, q.qy, q.qz, q.qw)
  if (!Number.isFinite(length) || length < 1e-9) return { qx: 0, qy: 0, qz: 0, qw: 1 }
  const sign = q.qw < 0 ? -1 : 1
  // `+ 0` folds -0 into 0, so a turn can't fingerprint two ways.
  return {
    qx: (sign * q.qx) / length + 0,
    qy: (sign * q.qy) / length + 0,
    qz: (sign * q.qz) / length + 0,
    qw: (sign * q.qw) / length + 0,
  }
}

export function meshBox(positions: Float32Array): Box {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[i + axis] ?? 0
      if (value < min[axis]!) min[axis] = value
      if (value > max[axis]!) max[axis] = value
    }
  }
  return { min, max }
}

export const boxCentre = (box: Box): [number, number, number] => [
  (box.min[0] + box.max[0]) / 2,
  (box.min[1] + box.max[1]) / 2,
  (box.min[2] + box.max[2]) / 2,
]

/** Rotation times scale, row-major. */
function linearPart(placement: Placement): Affine['m'] {
  const { qx, qy, qz, qw } = canonicalQuat(placement)
  const r = [
    1 - 2 * (qy * qy + qz * qz),
    2 * (qx * qy - qz * qw),
    2 * (qx * qz + qy * qw),
    2 * (qx * qy + qz * qw),
    1 - 2 * (qx * qx + qz * qz),
    2 * (qy * qz - qx * qw),
    2 * (qx * qz - qy * qw),
    2 * (qy * qz + qx * qw),
    1 - 2 * (qx * qx + qy * qy),
  ]
  const s = [placement.sx, placement.sy, placement.sz]
  return r.map((value, index) => value * s[index % 3]!) as Affine['m']
}

/**
 * The transform that puts a mesh where its placement says. Needs the vertices, not only the
 * box: after a turn, the lowest point is a vertex, and a corner of the old box would leave the
 * object hovering.
 */
export function placementAffine(positions: Float32Array, placement: Placement): Affine {
  const m = linearPart(placement)
  const [cx, cy, cz] = boxCentre(meshBox(positions))

  let lowest = Infinity
  for (let i = 0; i < positions.length; i += 3) {
    const vx = positions[i]! - cx
    const vy = positions[i + 1]! - cy
    const vz = positions[i + 2]! - cz
    const z = m[6] * vx + m[7] * vy + m[8] * vz
    if (z < lowest) lowest = z
  }
  if (!Number.isFinite(lowest)) lowest = 0

  // world = m·(v − c) + (x, y, −lowest)
  return {
    m,
    t: [
      placement.x - (m[0] * cx + m[1] * cy + m[2] * cz),
      placement.y - (m[3] * cx + m[4] * cy + m[5] * cz),
      -lowest - (m[6] * cx + m[7] * cy + m[8] * cz),
    ],
  }
}

export function applyAffine(affine: Affine, x: number, y: number, z: number) {
  const { m, t } = affine
  return [
    m[0] * x + m[1] * y + m[2] * z + t[0],
    m[3] * x + m[4] * y + m[5] * z + t[1],
    m[6] * x + m[7] * y + m[8] * z + t[2],
  ] as const
}

/** The placed object's box in plate coordinates. */
export function placedBox(positions: Float32Array, affine: Affine): Box {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) {
    const point = applyAffine(affine, positions[i]!, positions[i + 1]!, positions[i + 2]!)
    for (let axis = 0; axis < 3; axis++) {
      if (point[axis]! < min[axis]!) min[axis] = point[axis]!
      if (point[axis]! > max[axis]!) max[axis] = point[axis]!
    }
  }
  return { min, max }
}

/** The convex hull of the placed object's shadow on the plate, counter-clockwise. */
export function footprint(positions: Float32Array, affine: Affine): [number, number][] {
  const points: [number, number][] = []
  for (let i = 0; i < positions.length; i += 3) {
    const [x, y] = applyAffine(affine, positions[i]!, positions[i + 1]!, positions[i + 2]!)
    points.push([x, y])
  }
  return convexHull(points)
}

/** Andrew's monotone chain. */
export function convexHull(input: [number, number][]): [number, number][] {
  const points = [...input].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (points.length < 3) return points
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: [number, number][] = []
  for (const point of points) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop()
    lower.push(point)
  }
  const upper: [number, number][] = []
  for (const point of points.toReversed()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop()
    upper.push(point)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

/** Whether a convex polygon and an axis-aligned rectangle overlap (separating axes). */
export function hullTouchesRect(
  hull: [number, number][],
  rect: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  if (hull.length === 0) return false
  const xs = hull.map(([x]) => x)
  const ys = hull.map(([, y]) => y)
  if (Math.max(...xs) <= rect.minX || Math.min(...xs) >= rect.maxX) return false
  if (Math.max(...ys) <= rect.minY || Math.min(...ys) >= rect.maxY) return false

  const corners: [number, number][] = [
    [rect.minX, rect.minY],
    [rect.maxX, rect.minY],
    [rect.maxX, rect.maxY],
    [rect.minX, rect.maxY],
  ]
  for (let i = 0; i < hull.length; i++) {
    const [ax, ay] = hull[i]!
    const [bx, by] = hull[(i + 1) % hull.length]!
    const nx = by - ay
    const ny = ax - bx
    const project = (points: [number, number][]) => points.map(([x, y]) => x * nx + y * ny)
    const a = project(hull)
    const b = project(corners)
    if (Math.max(...a) <= Math.min(...b) || Math.max(...b) <= Math.min(...a)) return false
  }
  return true
}

export type FitProblem = 'offPlate' | 'tooTall' | 'noGo'

/** Small enough to forgive float noise from the browser's numbers, too small to matter on a part. */
const EPSILON = 1e-3

export function fitProblem(positions: Float32Array, affine: Affine, bed: Bed): FitProblem | null {
  const box = placedBox(positions, affine)
  if (
    box.min[0] < -EPSILON ||
    box.min[1] < -EPSILON ||
    box.max[0] > bed.width + EPSILON ||
    box.max[1] > bed.depth + EPSILON
  ) {
    return 'offPlate'
  }
  if (box.max[2] > bed.height + EPSILON) return 'tooTall'
  if (bed.exclude && hullTouchesRect(footprint(positions, affine), bed.exclude)) return 'noGo'
  return null
}
