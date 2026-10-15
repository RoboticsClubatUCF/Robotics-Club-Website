import type { ApiPlacement } from '../api/api'
import {
  type Affine,
  type Bed,
  type Box,
  type FitProblem,
  MAX_SCALE,
  MIN_SCALE,
  applyAffine,
  footprint,
  hullTouchesRect,
  placedBox,
  placementAffine,
} from './plateTransform'

/**
 * The plate's geometry, cached per mesh and turn so a drag doesn't walk every vertex on every
 * pointer move. Only the turn and the scale need the vertices; moving is adding (x, y). The
 * answers are the same as `plateTransform.ts` gives, which is what the worker checks with.
 */

interface AtOrigin {
  affine: Affine
  box: Box
  hull: [number, number][]
}

const cache = new WeakMap<Float32Array, Map<string, AtOrigin>>()

const turnKey = (p: ApiPlacement) => [p.qx, p.qy, p.qz, p.qw, p.sx, p.sy, p.sz].join(',')

function atOrigin(positions: Float32Array, placement: ApiPlacement): AtOrigin {
  let byTurn = cache.get(positions)
  if (!byTurn) {
    byTurn = new Map()
    cache.set(positions, byTurn)
  }
  const key = turnKey(placement)
  let found = byTurn.get(key)
  if (!found) {
    const affine = placementAffine(positions, { ...placement, x: 0, y: 0 })
    found = { affine, box: placedBox(positions, affine), hull: footprint(positions, affine) }
    if (byTurn.size > 200) byTurn.clear()
    byTurn.set(key, found)
  }
  return found
}

/** The placed object's box on the plate. */
export function boxOn(positions: Float32Array, placement: ApiPlacement): Box {
  const { box } = atOrigin(positions, placement)
  return {
    min: [box.min[0] + placement.x, box.min[1] + placement.y, box.min[2]],
    max: [box.max[0] + placement.x, box.max[1] + placement.y, box.max[2]],
  }
}

/** Why the worker would refuse this object where it is, or null. */
export function fitOn(positions: Float32Array, placement: ApiPlacement, bed: Bed): FitProblem | null {
  const { hull } = atOrigin(positions, placement)
  const box = boxOn(positions, placement)
  const e = 1e-3
  if (box.min[0] < -e || box.min[1] < -e || box.max[0] > bed.width + e || box.max[1] > bed.depth + e) {
    return 'offPlate'
  }
  if (box.max[2] > bed.height + e) return 'tooTall'
  if (bed.exclude) {
    const shifted = hull.map(([x, y]) => [x + placement.x, y + placement.y] as [number, number])
    if (hullTouchesRect(shifted, bed.exclude)) return 'noGo'
  }
  return null
}

/**
 * The scale grown by `ratio` on every axis, so the part keeps its shape. The ratio stops where the
 * first axis meets MIN_SCALE or MAX_SCALE; clamping each axis on its own would stretch the part.
 */
export function scaleBy(scale: { sx: number; sy: number; sz: number }, ratio: number) {
  const axes = [scale.sx, scale.sy, scale.sz]
  const low = Math.max(...axes.map((s) => MIN_SCALE / s))
  const high = Math.min(...axes.map((s) => MAX_SCALE / s))
  const r = Number.isFinite(ratio) ? Math.min(high, Math.max(low, ratio)) : 1
  const clamp = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))
  return { sx: clamp(scale.sx * r), sy: clamp(scale.sy * r), sz: clamp(scale.sz * r) }
}

/** Orca's threshold of 0 means it judges overhangs itself; this is what its default would. */
const DEFAULT_THRESHOLD = 30

/** Within this of the bed, a face is printed on the bed rather than over air. */
const ON_BED = 0.05

const overhangs = new WeakMap<Float32Array, Map<string, number>>()

/**
 * How much of the part's underside, in mm² seen from below, is flatter than `threshold` degrees
 * and off the bed: what Orca would put supports under. Moving the part doesn't change it, so it's
 * kept per turn and scale like the box.
 */
export function overhangOn(positions: Float32Array, placement: ApiPlacement, threshold: number): number {
  const degrees = threshold > 0 ? threshold : DEFAULT_THRESHOLD
  let byTurn = overhangs.get(positions)
  if (!byTurn) {
    byTurn = new Map()
    overhangs.set(positions, byTurn)
  }
  const key = `${turnKey(placement)}:${String(degrees)}`
  const known = byTurn.get(key)
  if (known !== undefined) return known

  const { affine } = atOrigin(positions, placement)
  const cos = Math.cos((degrees * Math.PI) / 180)
  let area = 0
  for (let i = 0; i < positions.length; i += 9) {
    const a = applyAffine(affine, positions[i]!, positions[i + 1]!, positions[i + 2]!)
    const b = applyAffine(affine, positions[i + 3]!, positions[i + 4]!, positions[i + 5]!)
    const c = applyAffine(affine, positions[i + 6]!, positions[i + 7]!, positions[i + 8]!)
    if (Math.max(a[2], b[2], c[2]) < ON_BED) continue
    const [ux, uy, uz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const [vx, vy, vz] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    // Facing down, and closer to flat than the threshold: the normal within it of straight down.
    if (nz >= 0 || -nz <= cos * Math.hypot(nx, ny, nz)) continue
    area += -nz / 2
  }
  if (byTurn.size > 200) byTurn.clear()
  byTurn.set(key, area)
  return area
}

/** The footprint size at this turn and scale, for finding room for a copy. */
export function sizeOf(positions: Float32Array, placement: ApiPlacement): { w: number; d: number } {
  const { box } = atOrigin(positions, placement)
  return { w: box.max[0] - box.min[0], d: box.max[1] - box.min[1] }
}
