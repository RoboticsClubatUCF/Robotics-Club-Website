import { type Bed, type Placement, placedBox, placementAffine } from './plateTransform'

/**
 * Laying copies out on the bed, the workspace's ARRANGE.
 *
 * Shelf packing on each copy's footprint at its current turn and size: rows from the front-left,
 * tallest footprint first, then the whole layout centred on the bed if that keeps it clear of the
 * purge corner. Orca arranges by convex hull and packs tighter; this is plainer but instant, and
 * the worker slices with arranging off, so what it lays out is exactly what prints.
 */

export interface ArrangeItem {
  id: string
  positions: Float32Array
  placement: Placement
}

export interface Arrangement {
  /** New centres, by object id. */
  placed: Map<string, { x: number; y: number }>
  /** Objects that didn't fit on the plate; they keep where they were. */
  unplaced: string[]
}

/** Clearance between copies, and from the bed's edge. */
export const ARRANGE_GAP = 6

interface Rect {
  x: number
  y: number
  w: number
  d: number
}

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.d && b.y < a.y + a.d

export function arrange(items: ArrangeItem[], bed: Bed, gap = ARRANGE_GAP): Arrangement {
  const sized = items.map((item) => {
    const box = placedBox(item.positions, placementAffine(item.positions, { ...item.placement, x: 0, y: 0 }))
    return { id: item.id, w: box.max[0] - box.min[0], d: box.max[1] - box.min[1] }
  })
  const order = [...sized].sort((a, b) => b.d - a.d || b.w - a.w)

  const noGo: Rect | null = bed.exclude
    ? {
        x: bed.exclude.minX - gap,
        y: bed.exclude.minY - gap,
        w: bed.exclude.maxX - bed.exclude.minX + 2 * gap,
        d: bed.exclude.maxY - bed.exclude.minY + 2 * gap,
      }
    : null

  const rects = new Map<string, Rect>()
  const unplaced: string[] = []
  let rowY = gap
  let rowDepth = 0
  let cursor = gap

  for (const item of order) {
    if (item.w > bed.width - 2 * gap || item.d > bed.depth - 2 * gap) {
      unplaced.push(item.id)
      continue
    }
    let placed = false
    while (!placed) {
      if (cursor + item.w > bed.width - gap) {
        rowY += rowDepth + gap
        cursor = gap
        rowDepth = 0
      }
      if (rowY + item.d > bed.depth - gap) break
      const rect = { x: cursor, y: rowY, w: item.w, d: item.d }
      if (noGo && overlaps(rect, noGo)) {
        cursor = noGo.x + noGo.w + gap
        continue
      }
      rects.set(item.id, rect)
      cursor += item.w + gap
      rowDepth = Math.max(rowDepth, item.d)
      placed = true
    }
    if (!placed) unplaced.push(item.id)
  }

  // Centre the group if that doesn't push anything into the purge corner.
  const all = [...rects.values()]
  if (all.length > 0) {
    const minX = Math.min(...all.map((r) => r.x))
    const maxX = Math.max(...all.map((r) => r.x + r.w))
    const minY = Math.min(...all.map((r) => r.y))
    const maxY = Math.max(...all.map((r) => r.y + r.d))
    const dx = (bed.width - (maxX - minX)) / 2 - minX
    const dy = (bed.depth - (maxY - minY)) / 2 - minY
    const shifted = all.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }))
    if (!noGo || !shifted.some((r) => overlaps(r, noGo))) {
      for (const [id, rect] of rects) rects.set(id, { ...rect, x: rect.x + dx, y: rect.y + dy })
    }
  }

  const placed = new Map<string, { x: number; y: number }>()
  for (const [id, rect] of rects) placed.set(id, { x: rect.x + rect.w / 2, y: rect.y + rect.d / 2 })
  return { placed, unplaced }
}

/**
 * Where a new model of this footprint can go without touching what's already on the plate: the
 * free spot nearest the centre, on a 5 mm grid. The centre if nothing is free, for ARRANGE to sort
 * out.
 */
export function freeSpot(
  taken: { min: [number, number, number]; max: [number, number, number] }[],
  size: { w: number; d: number },
  bed: Bed,
  gap = ARRANGE_GAP,
): { x: number; y: number } {
  const centre = { x: bed.width / 2, y: bed.depth / 2 }
  const blocked: Rect[] = taken.map((box) => ({
    x: box.min[0] - gap,
    y: box.min[1] - gap,
    w: box.max[0] - box.min[0] + 2 * gap,
    d: box.max[1] - box.min[1] + 2 * gap,
  }))
  if (bed.exclude) {
    blocked.push({
      x: bed.exclude.minX - gap,
      y: bed.exclude.minY - gap,
      w: bed.exclude.maxX - bed.exclude.minX + 2 * gap,
      d: bed.exclude.maxY - bed.exclude.minY + 2 * gap,
    })
  }
  let best: { x: number; y: number; distance: number } | null = null
  for (let x = size.w / 2 + gap; x <= bed.width - size.w / 2 - gap; x += 5) {
    for (let y = size.d / 2 + gap; y <= bed.depth - size.d / 2 - gap; y += 5) {
      const rect = { x: x - size.w / 2, y: y - size.d / 2, w: size.w, d: size.d }
      if (blocked.some((other) => overlaps(rect, other))) continue
      const distance = Math.hypot(x - centre.x, y - centre.y)
      if (!best || distance < best.distance) best = { x, y, distance }
    }
  }
  return best ? { x: best.x, y: best.y } : centre
}
