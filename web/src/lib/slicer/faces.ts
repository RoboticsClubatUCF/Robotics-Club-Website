/**
 * The flat faces a model can lie on, for LAY ON FACE to show before anything is clicked.
 *
 * A face qualifies when it's flat and nothing of the model sticks out past it: put down, it's
 * what touches the bed. Coplanar triangles count as one face even when they're apart, so a table
 * offers the bottoms of its four legs as one. The same rule as Orca's place-on-face, found from
 * the triangles rather than a convex hull, so a curved part offers only its truly flat faces.
 */

export interface RestingFace {
  /** Outward unit normal, in the mesh's own coordinates. */
  normal: [number, number, number]
  /** mm², at the mesh's own size. */
  area: number
  /** The face's triangles, nine floats each, in the mesh's own coordinates. */
  positions: Float32Array
  /** Its edge, as line segments of six floats each, so faces side by side read as separate. */
  outline: Float32Array
}

/** Triangles within about a quarter of a degree, and 0.05 mm of each other, share a plane. */
const NORMAL_STEP = 1 / 256
const PLANE_STEP = 0.05
const SAME_NORMAL = Math.cos((0.5 * Math.PI) / 180)
/** How far a vertex may sit past a face before the face doesn't touch the bed. */
const ON_PLANE = 0.02
/** Smaller than this and it isn't worth a click. */
const MIN_AREA = 1
/** As many as Orca shows; a coarse cylinder's sides each count. */
const MAX_FACES = 256
/** Big enough planes looked at before giving up on the rest. */
const MAX_TRIED = 2000
/** Cells joined into planes, biggest first; past this they're specks. */
const MAX_CELLS = 4000
/** Vertices are checked in runs this long, a run skipped whole when its box can't reach. */
const RUN = 128
/** Past this many triangles a face goes without an outline rather than hold up the click. */
const MAX_OUTLINED = 20_000

const cache = new WeakMap<Float32Array, RestingFace[]>()

/** The faces of this mesh it could lie on, biggest first. Cached per mesh. */
export function restingFaces(positions: Float32Array): RestingFace[] {
  let faces = cache.get(positions)
  if (!faces) {
    faces = find(positions)
    cache.set(positions, faces)
  }
  return faces
}

/** A number naming a cell of normal and plane offset; exact, since it stays under 2^53. */
function keyOf(nx: number, ny: number, nz: number, d: number): number {
  const qx = Math.round(nx / NORMAL_STEP) + 256
  const qy = Math.round(ny / NORMAL_STEP) + 256
  const qz = Math.round(nz / NORMAL_STEP) + 256
  const qd = Math.round(d / PLANE_STEP) + 2 ** 19
  return ((qx * 513 + qy) * 513 + qz) * 2 ** 20 + qd
}

function find(positions: Float32Array): RestingFace[] {
  const triangles = Math.floor(positions.length / 9)

  // Every triangle into a cell of like normal and offset, keeping only sums. A cell's normal is
  // area-weighted; its offset is the range its triangles span.
  const keys = new Float64Array(triangles).fill(Number.NaN)
  const cellOf = new Map<number, number>()
  const area: number[] = []
  const nx: number[] = []
  const ny: number[] = []
  const nz: number[] = []
  const hi: number[] = []
  const lo: number[] = []
  for (let t = 0; t < triangles; t++) {
    const i = t * 9
    const ax = positions[i + 3]! - positions[i]!
    const ay = positions[i + 4]! - positions[i + 1]!
    const az = positions[i + 5]! - positions[i + 2]!
    const bx = positions[i + 6]! - positions[i]!
    const by = positions[i + 7]! - positions[i + 1]!
    const bz = positions[i + 8]! - positions[i + 2]!
    const cx = ay * bz - az * by
    const cy = az * bx - ax * bz
    const cz = ax * by - ay * bx
    const double = Math.sqrt(cx * cx + cy * cy + cz * cz)
    if (double < 1e-12) continue
    const ux = cx / double
    const uy = cy / double
    const uz = cz / double
    const d = ux * positions[i]! + uy * positions[i + 1]! + uz * positions[i + 2]!
    const key = keyOf(ux, uy, uz, d)
    keys[t] = key
    const a = double / 2
    const cell = cellOf.get(key)
    if (cell === undefined) {
      cellOf.set(key, area.length)
      area.push(a)
      nx.push(ux * a)
      ny.push(uy * a)
      nz.push(uz * a)
      hi.push(d)
      lo.push(d)
    } else {
      area[cell]! += a
      nx[cell]! += ux * a
      ny[cell]! += uy * a
      nz[cell]! += uz * a
      if (d > hi[cell]!) hi[cell] = d
      if (d < lo[cell]!) lo[cell] = d
    }
  }

  // A plane whose triangles straddle a cell boundary is joined back up. Only cells that could add
  // up to a face take part; a curved part's thousands of specks don't.
  const cells = [...area.keys()].filter((cell) => area[cell]! >= MIN_AREA / 8)
  cells.sort((a, b) => area[b]! - area[a]!)
  const plane = new Int32Array(area.length).fill(-1)
  const planes: { cell: number; x: number; y: number; z: number }[] = []
  for (const cell of cells.slice(0, MAX_CELLS)) {
    const length = Math.sqrt(nx[cell]! ** 2 + ny[cell]! ** 2 + nz[cell]! ** 2)
    const x = nx[cell]! / length
    const y = ny[cell]! / length
    const z = nz[cell]! / length
    const into =
      planes.find(
        (p) =>
          p.x * x + p.y * y + p.z * z > SAME_NORMAL && Math.abs(hi[p.cell]! - hi[cell]!) < PLANE_STEP * 1.5,
      )?.cell ?? -1
    if (into === -1) {
      plane[cell] = cell
      planes.push({ cell, x, y, z })
    } else {
      plane[cell] = into
      area[into]! += area[cell]!
      nx[into]! += nx[cell]!
      ny[into]! += ny[cell]!
      nz[into]! += nz[cell]!
      hi[into] = Math.max(hi[into]!, hi[cell]!)
      lo[into] = Math.min(lo[into]!, lo[cell]!)
    }
  }

  // Each run of vertices gets a box, so a plane well clear of it skips the run.
  const vertices = positions.length / 3
  const runs = Math.ceil(vertices / RUN)
  const box = new Float64Array(runs * 6)
  let extent = 0
  for (let r = 0; r < runs; r++) {
    box.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], r * 6)
    for (let v = r * RUN; v < Math.min(vertices, (r + 1) * RUN); v++) {
      for (let k = 0; k < 3; k++) {
        const value = positions[v * 3 + k]!
        if (value < box[r * 6 + k]!) box[r * 6 + k] = value
        if (value > box[r * 6 + 3 + k]!) box[r * 6 + 3 + k] = value
        if (Math.abs(value) > extent) extent = Math.abs(value)
      }
    }
  }
  /** Whether no vertex reaches past `limit` along (x, y, z). */
  const clear = (x: number, y: number, z: number, limit: number) => {
    for (let r = 0; r < runs; r++) {
      const o = r * 6
      const reach =
        (x > 0 ? box[o + 3]! : box[o]!) * x +
        (y > 0 ? box[o + 4]! : box[o + 1]!) * y +
        (z > 0 ? box[o + 5]! : box[o + 2]!) * z
      if (reach <= limit) continue
      for (let v = r * RUN; v < Math.min(vertices, (r + 1) * RUN); v++) {
        if (x * positions[v * 3]! + y * positions[v * 3 + 1]! + z * positions[v * 3 + 2]! > limit) {
          return false
        }
      }
    }
    return true
  }

  // Of the planes big enough, the ones nothing sticks out past. One that fails facing out is
  // tried facing in, for a file saved inside out, whose triangles all face the wrong way.
  const slack = ON_PLANE + extent * 1e-5
  const chosen: { plane: number; normal: [number, number, number]; area: number }[] = []
  const order = planes
    .map((p) => p.cell)
    .filter((p) => area[p]! >= MIN_AREA)
    .sort((a, b) => area[b]! - area[a]!)
  for (const p of order.slice(0, MAX_TRIED)) {
    if (chosen.length >= MAX_FACES) break
    const length = Math.sqrt(nx[p]! ** 2 + ny[p]! ** 2 + nz[p]! ** 2)
    const x = nx[p]! / length
    const y = ny[p]! / length
    const z = nz[p]! / length
    if (clear(x, y, z, hi[p]! + slack)) chosen.push({ plane: p, normal: [x, y, z], area: area[p]! })
    else if (clear(-x, -y, -z, -lo[p]! + slack)) chosen.push({ plane: p, normal: [-x, -y, -z], area: area[p]! })
  }
  if (chosen.length === 0) return []

  // The chosen planes' triangles, for drawing.
  const slot = new Map(chosen.map((face, at) => [face.plane, at]))
  const parts: number[][] = chosen.map(() => [])
  for (let t = 0; t < triangles; t++) {
    const key = keys[t]!
    if (Number.isNaN(key)) continue
    const at = slot.get(plane[cellOf.get(key)!]!)
    if (at === undefined) continue
    for (let k = 0; k < 9; k++) parts[at]!.push(positions[t * 9 + k]!)
  }
  return chosen.map((face, at) => ({
    normal: face.normal,
    area: face.area,
    positions: new Float32Array(parts[at]!),
    outline: outlineOf(parts[at]!),
  }))
}

/** The edges only one of the triangles has: the face's boundary, holes included. */
function outlineOf(p: number[]): Float32Array {
  if (p.length / 9 > MAX_OUTLINED) return new Float32Array(0)
  const point = (i: number) => `${String(p[i])},${String(p[i + 1])},${String(p[i + 2])}`
  const edges = new Map<string, { count: number; from: number; to: number }>()
  for (let i = 0; i + 8 < p.length; i += 9) {
    for (const [from, to] of [[i, i + 3], [i + 3, i + 6], [i + 6, i]] as const) {
      const a = point(from)
      const b = point(to)
      const key = a < b ? `${a}|${b}` : `${b}|${a}`
      const edge = edges.get(key)
      if (edge) edge.count++
      else edges.set(key, { count: 1, from, to })
    }
  }
  const out: number[] = []
  for (const { count, from, to } of edges.values()) {
    if (count === 1) out.push(p[from]!, p[from + 1]!, p[from + 2]!, p[to]!, p[to + 1]!, p[to + 2]!)
  }
  return new Float32Array(out)
}
