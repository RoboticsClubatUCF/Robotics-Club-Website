import type { ApiPlacement } from '../api/api'
import {
  type Affine,
  type Bed,
  type Box,
  type FitProblem,
  MAX_SCALE,
  MIN_SCALE,
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

/** The footprint size at this turn and scale, for finding room for a copy. */
export function sizeOf(positions: Float32Array, placement: ApiPlacement): { w: number; d: number } {
  const { box } = atOrigin(positions, placement)
  return { w: box.max[0] - box.min[0], d: box.max[1] - box.min[1] }
}
