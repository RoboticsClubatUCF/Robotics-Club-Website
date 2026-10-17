/**
 * Turning a model so it prints well: the workspace's AUTO-ORIENT and LAY ON FACE.
 *
 * Auto-orient tries a set of faces as the one to put down (the six axes and the model's largest
 * flat areas) and keeps the turn with the least downward-facing surface off the bed, a little
 * credit for contact with the bed and a little cost for height. Orca's own orient weighs more
 * things; this is the same idea, run in the browser so it answers at once.
 */

export interface Quat {
  qx: number
  qy: number
  qz: number
  qw: number
}

/** A deliberate rotation, separate from a part's final orientation. */
export type RotationChange = { objectId: string } & (
  | { axis: 'x' | 'y' | 'z'; degrees: number }
  | { reset: true }
)

/** Signed change about a world-axis ring, including a part already tilted on other axes. */
export function rotationDelta(from: Quat, to: Quat, axis: 'x' | 'y' | 'z'): number {
  const delta = multiply(to, { qx: -from.qx, qy: -from.qy, qz: -from.qz, qw: from.qw })
  const angle = 2 * Math.atan2(delta[axis === 'x' ? 'qx' : axis === 'y' ? 'qy' : 'qz'], delta.qw)
  return Math.atan2(Math.sin(angle), Math.cos(angle)) * 180 / Math.PI
}

const IDENTITY: Quat = { qx: 0, qy: 0, qz: 0, qw: 1 }

/** Steeper than this from the bed and a face needs support. Orca's default threshold is 30°. */
const OVERHANG_COS = Math.cos((60 * Math.PI) / 180)

export function multiply(a: Quat, b: Quat): Quat {
  return {
    qw: a.qw * b.qw - a.qx * b.qx - a.qy * b.qy - a.qz * b.qz,
    qx: a.qw * b.qx + a.qx * b.qw + a.qy * b.qz - a.qz * b.qy,
    qy: a.qw * b.qy - a.qx * b.qz + a.qy * b.qw + a.qz * b.qx,
    qz: a.qw * b.qz + a.qx * b.qy - a.qy * b.qx + a.qz * b.qw,
  }
}

export function rotate(q: Quat, v: [number, number, number]): [number, number, number] {
  const { qx, qy, qz, qw } = q
  const [x, y, z] = v
  const ix = qw * x + qy * z - qz * y
  const iy = qw * y + qz * x - qx * z
  const iz = qw * z + qx * y - qy * x
  const iw = -qx * x - qy * y - qz * z
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ]
}

/** The shortest turn taking unit vector `from` onto unit vector `to`. */
export function fromVectors(from: [number, number, number], to: [number, number, number]): Quat {
  const dot = from[0] * to[0] + from[1] * to[1] + from[2] * to[2]
  if (dot < -0.999999) {
    // Opposite: half a turn about any axis at right angles to `from`.
    const axis: [number, number, number] =
      Math.abs(from[0]) < 0.9 ? [0, -from[2], from[1]] : [-from[2], 0, from[0]]
    const length = Math.hypot(...axis)
    return { qx: axis[0] / length, qy: axis[1] / length, qz: axis[2] / length, qw: 0 }
  }
  const q = {
    qx: from[1] * to[2] - from[2] * to[1],
    qy: from[2] * to[0] - from[0] * to[2],
    qz: from[0] * to[1] - from[1] * to[0],
    qw: 1 + dot,
  }
  const length = Math.hypot(q.qx, q.qy, q.qz, q.qw)
  return { qx: q.qx / length, qy: q.qy / length, qz: q.qz / length, qw: q.qw / length }
}

const DOWN: [number, number, number] = [0, 0, -1]

/** The turn that puts a face pointing `normal` (already turned) flat on the bed, after `current`. */
export function layFlat(current: Quat, normal: [number, number, number]): Quat {
  const length = Math.hypot(...normal) || 1
  const unit: [number, number, number] = [normal[0] / length, normal[1] / length, normal[2] / length]
  return multiply(fromVectors(unit, DOWN), current)
}

interface Face {
  n: [number, number, number]
  area: number
  i: number
}

function facesOf(positions: Float32Array, scale: [number, number, number]): Face[] {
  const faces: Face[] = []
  for (let i = 0; i < positions.length; i += 9) {
    const p = (k: number) => positions[i + k]! * scale[k % 3]!
    const ax = p(3) - p(0)
    const ay = p(4) - p(1)
    const az = p(5) - p(2)
    const bx = p(6) - p(0)
    const by = p(7) - p(1)
    const bz = p(8) - p(2)
    const n: [number, number, number] = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx]
    const double = Math.hypot(...n)
    if (double === 0) continue
    faces.push({ n: [n[0] / double, n[1] / double, n[2] / double], area: double / 2, i })
  }
  return faces
}

/** The directions worth trying as "down": the six axes and the biggest flat areas. */
function candidates(faces: Face[]): [number, number, number][] {
  const bins = new Map<string, { n: [number, number, number]; area: number }>()
  for (const face of faces) {
    // About 6° bins.
    const key = face.n.map((v) => Math.round(v * 10)).join(',')
    const bin = bins.get(key)
    if (bin) bin.area += face.area
    else bins.set(key, { n: face.n, area: face.area })
  }
  const largest = [...bins.values()]
    .sort((a, b) => b.area - a.area)
    .slice(0, 12)
    .map((bin) => bin.n)
  const axes: [number, number, number][] = [
    [0, 0, -1], [0, 0, 1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0],
  ]
  return [...axes, ...largest]
}

export function score(positions: Float32Array, faces: Face[], q: Quat, scale: [number, number, number]) {
  let lowest = Infinity
  let highest = -Infinity
  const zs = new Float32Array(positions.length / 3)
  for (let v = 0; v < zs.length; v++) {
    const z = rotate(q, [
      positions[v * 3]! * scale[0],
      positions[v * 3 + 1]! * scale[1],
      positions[v * 3 + 2]! * scale[2],
    ])[2]
    zs[v] = z
    if (z < lowest) lowest = z
    if (z > highest) highest = z
  }
  let overhang = 0
  let contact = 0
  let total = 0
  for (const face of faces) {
    total += face.area
    const nz = rotate(q, face.n)[2]
    if (nz >= -OVERHANG_COS) continue
    const v = face.i / 3
    const onBed = Math.max(zs[v]!, zs[v + 1]!, zs[v + 2]!) - lowest < 0.05
    if (onBed) contact += face.area
    else overhang += face.area * -nz
  }
  return overhang - 0.25 * contact + 0.05 * (highest - lowest) * Math.sqrt(total)
}

/** The best turn found for this mesh at this scale. */
export function autoOrient(positions: Float32Array, scale: [number, number, number] = [1, 1, 1]): Quat {
  const faces = facesOf(positions, scale)
  if (faces.length === 0) return IDENTITY
  let best = IDENTITY
  let bestScore = Infinity
  for (const down of candidates(faces)) {
    const q = fromVectors(down, DOWN)
    const value = score(positions, faces, q, scale)
    if (value < bestScore - 1e-6) {
      bestScore = value
      best = q
    }
  }
  return best
}
