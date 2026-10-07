import { gzipSync } from 'fflate'

/**
 * The plate's own G-code as a compact layer preview for the workspace.
 *
 * Read from what Orca will actually print, not re-derived from the mesh, so the preview is the
 * print. Arcs are cut into chords: the approved process has arc fitting on, and a reader that
 * skips G2/G3 (as three.js's stock loader does) loses most of every curved wall.
 *
 * Format, gzipped, little-endian ("RCPV" 1). `web/src/lib/slicer/preview.ts` reads it.
 *
 *   0   "RCPV", u8 version, 3 reserved bytes
 *   8   f32 bed width, depth, height
 *   20  u32 layer count, u32 segment count
 *   28  f32 extrusion bounds: min x, y, z, max x, y, z
 *   52  per layer: f32 z, f32 height, varint path count;
 *       per path: u8 role, varint point count, then zigzag-varint x/y deltas in 0.01 mm.
 *       The delta cursor carries on across paths and layers.
 */

export const ROLES = ['outerWall', 'innerWall', 'sparseInfill', 'solidInfill', 'support', 'other'] as const
export type Role = (typeof ROLES)[number]

export class PreviewError extends Error {}

export interface PreviewLimits {
  maxSegments: number
  maxBytes: number
}

export interface Preview {
  bytes: Uint8Array
  layers: number
  segments: number
}

/** How far a chord may stray from the arc it replaces. */
const CHORD_TOLERANCE = 0.02
const MAX_ARC_CHORDS = 720

export function roleOf(type: string): Role {
  const t = type.trim().toLowerCase()
  if (t.startsWith('support')) return 'support'
  if (t === 'outer wall' || t === 'overhang wall' || t === 'external perimeter') return 'outerWall'
  if (t.endsWith('wall') || t === 'perimeter') return 'innerWall'
  if (t === 'sparse infill' || t === 'internal infill') return 'sparseInfill'
  if (t.includes('infill') || t.includes('surface') || t.includes('bridge') || t === 'ironing') {
    return 'solidInfill'
  }
  return 'other'
}

class Bytes {
  buffer = new Uint8Array(1 << 16)
  length = 0

  private room(extra: number) {
    if (this.length + extra <= this.buffer.length) return
    let size = this.buffer.length * 2
    while (size < this.length + extra) size *= 2
    const next = new Uint8Array(size)
    next.set(this.buffer.subarray(0, this.length))
    this.buffer = next
  }

  u8(value: number) {
    this.room(1)
    this.buffer[this.length++] = value
  }

  u32(value: number) {
    this.room(4)
    new DataView(this.buffer.buffer).setUint32(this.length, value, true)
    this.length += 4
  }

  f32(value: number) {
    this.room(4)
    new DataView(this.buffer.buffer).setFloat32(this.length, value, true)
    this.length += 4
  }

  varint(value: number) {
    this.room(10)
    let v = value
    while (v >= 0x80) {
      this.buffer[this.length++] = (v & 0x7f) | 0x80
      v = Math.floor(v / 128)
    }
    this.buffer[this.length++] = v
  }

  zigzag(value: number) {
    this.varint(value < 0 ? -value * 2 - 1 : value * 2)
  }
}

interface Path {
  role: number
  points: number[]
}

interface Layer {
  z: number
  height: number
  paths: Path[]
}

/** Reads one parameter's number off a G-code line: `X10.5` → 10.5. No exponents in G-code. */
function param(line: string, letter: string): number | undefined {
  const at = line.indexOf(letter, 2)
  if (at === -1) return undefined
  const match = /^-?\d*\.?\d+/.exec(line.slice(at + 1))
  return match ? Number(match[0]) : undefined
}

export function buildPreview(
  gcode: Uint8Array,
  bed: { width: number; depth: number; height: number },
  limits: PreviewLimits,
): Preview {
  const layers: Layer[] = []
  const early: Path[] = []
  let current: Layer | null = null
  let path: Path | null = null
  let declaredLayers: number | null = null
  let pendingZ: number | null = null
  let pendingHeight: number | null = null

  let role = ROLES.indexOf('other')
  let absolute = true
  let absoluteE = true
  let x = 0
  let y = 0
  let z = 0
  let e = 0
  let segments = 0
  const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]

  const endPath = () => {
    if (path && path.points.length >= 4) (current?.paths ?? early).push(path)
    path = null
  }

  const extrudeTo = (nx: number, ny: number) => {
    if (!path || path.role !== role) {
      endPath()
      path = { role, points: [Math.round(x * 100), Math.round(y * 100)] }
    }
    path.points.push(Math.round(nx * 100), Math.round(ny * 100))
    segments++
    if (segments > limits.maxSegments) {
      throw new PreviewError('The plate is too detailed to preview.')
    }
    if (ROLES[role] !== 'other') {
      const top = current?.z ?? z
      bounds[0] = Math.min(bounds[0]!, x, nx)
      bounds[1] = Math.min(bounds[1]!, y, ny)
      bounds[2] = Math.min(bounds[2]!, top)
      bounds[3] = Math.max(bounds[3]!, x, nx)
      bounds[4] = Math.max(bounds[4]!, y, ny)
      bounds[5] = Math.max(bounds[5]!, top)
    }
  }

  const handle = (raw: string) => {
    const line = raw.trim()
    if (line === '') return

    if (line.startsWith(';')) {
      const comment = line.slice(1).trim()
      if (comment === 'LAYER_CHANGE') {
        endPath()
        current = { z: pendingZ ?? z, height: pendingHeight ?? 0, paths: [] }
        layers.push(current)
        pendingZ = null
        pendingHeight = null
      } else if (comment.startsWith('Z:')) {
        const value = Number(comment.slice(2))
        if (current && current.paths.length === 0 && !path) current.z = value
        else pendingZ = value
      } else if (comment.startsWith('HEIGHT:')) {
        const value = Number(comment.slice(7))
        if (current && current.paths.length === 0 && !path) current.height = value
        else pendingHeight = value
      } else if (comment.startsWith('TYPE:') || comment.startsWith('FEATURE:')) {
        endPath()
        role = ROLES.indexOf(roleOf(comment.slice(comment.indexOf(':') + 1)))
      } else if (comment.startsWith('total layer number:')) {
        declaredLayers = Number(comment.slice('total layer number:'.length))
      }
      return
    }

    const code = line.split(/[\s;]/, 1)[0]!.toUpperCase()
    switch (code) {
      case 'G90':
        absolute = true
        return
      case 'G91':
        absolute = false
        return
      case 'M82':
        absoluteE = true
        return
      case 'M83':
        absoluteE = false
        return
      case 'G92': {
        e = param(line, 'E') ?? e
        x = param(line, 'X') ?? x
        y = param(line, 'Y') ?? y
        z = param(line, 'Z') ?? z
        return
      }
      case 'G28':
        x = 0
        y = 0
        z = 0
        endPath()
        return
      case 'G0':
      case 'G1':
      case 'G2':
      case 'G3':
        break
      default:
        return
    }

    const body = line.split(';', 1)[0]!
    const px = param(body, 'X')
    const py = param(body, 'Y')
    const pz = param(body, 'Z')
    const pe = param(body, 'E')
    const nx = px === undefined ? x : absolute ? px : x + px
    const ny = py === undefined ? y : absolute ? py : y + py
    const nz = pz === undefined ? z : absolute ? pz : z + pz
    const de = pe === undefined ? 0 : absoluteE ? pe - e : pe
    if (pe !== undefined) e = absoluteE ? pe : e + pe
    z = nz

    const extruding = de > 0 && (nx !== x || ny !== y)
    if (!extruding) {
      endPath()
      x = nx
      y = ny
      return
    }

    if (code === 'G2' || code === 'G3') {
      const chords = arcChords(code === 'G2', x, y, nx, ny, body)
      for (const [cx, cy] of chords) {
        extrudeTo(cx, cy)
        x = cx
        y = cy
      }
    } else {
      extrudeTo(nx, ny)
    }
    x = nx
    y = ny
  }

  forEachLine(gcode, handle)
  endPath()

  if (layers.length === 0) throw new PreviewError('The G-code has no layers in it.')
  if (early.length > 0) layers[0]!.paths.unshift(...early)
  if (declaredLayers !== null && declaredLayers !== layers.length) {
    throw new PreviewError(
      `Read ${String(layers.length)} layers but Orca said ${String(declaredLayers)}.`,
    )
  }

  const out = new Bytes()
  for (const c of 'RCPV') out.u8(c.charCodeAt(0))
  out.u8(1)
  out.u8(0)
  out.u8(0)
  out.u8(0)
  out.f32(bed.width)
  out.f32(bed.depth)
  out.f32(bed.height)
  out.u32(layers.length)
  out.u32(segments)
  for (const value of bounds) out.f32(Number.isFinite(value) ? value : 0)

  let cx = 0
  let cy = 0
  for (const layer of layers) {
    out.f32(layer.z)
    out.f32(layer.height)
    out.varint(layer.paths.length)
    for (const p of layer.paths) {
      out.u8(p.role)
      out.varint(p.points.length / 2)
      for (let i = 0; i < p.points.length; i += 2) {
        out.zigzag(p.points[i]! - cx)
        out.zigzag(p.points[i + 1]! - cy)
        cx = p.points[i]!
        cy = p.points[i + 1]!
      }
    }
  }

  const bytes = gzipSync(out.buffer.subarray(0, out.length), { level: 6 })
  if (bytes.byteLength > limits.maxBytes) {
    throw new PreviewError('The preview is too large to show.')
  }
  return { bytes, layers: layers.length, segments }
}

/** Chords along a G2 (clockwise) or G3 arc, ending exactly at its end point. */
function arcChords(
  clockwise: boolean,
  x: number,
  y: number,
  nx: number,
  ny: number,
  body: string,
): [number, number][] {
  let cx: number
  let cy: number
  const i = param(body, 'I')
  const j = param(body, 'J')
  const r = param(body, 'R')
  if (i !== undefined || j !== undefined) {
    cx = x + (i ?? 0)
    cy = y + (j ?? 0)
  } else if (r !== undefined) {
    // The centre on the side the sign of R picks.
    const dx = nx - x
    const dy = ny - y
    const chord = Math.hypot(dx, dy)
    if (chord === 0 || Math.abs(r) < chord / 2) return [[nx, ny]]
    const h = Math.sqrt(r * r - (chord * chord) / 4) * ((clockwise ? 1 : -1) * Math.sign(r))
    cx = x + dx / 2 - (h * dy) / chord
    cy = y + dy / 2 + (h * dx) / chord
  } else {
    return [[nx, ny]]
  }

  const radius = Math.hypot(x - cx, y - cy)
  const start = Math.atan2(y - cy, x - cx)
  let end = Math.atan2(ny - cy, nx - cx)
  let sweep = end - start
  if (clockwise && sweep >= 0) sweep -= 2 * Math.PI
  if (!clockwise && sweep <= 0) sweep += 2 * Math.PI
  // Start equal to end is a full circle, which the arithmetic above already gives.
  end = start + sweep

  const step = radius > CHORD_TOLERANCE ? 2 * Math.acos(1 - CHORD_TOLERANCE / radius) : Math.PI
  const count = Math.min(MAX_ARC_CHORDS, Math.max(1, Math.ceil(Math.abs(sweep) / step)))
  const points: [number, number][] = []
  for (let k = 1; k < count; k++) {
    const angle = start + (sweep * k) / count
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)])
  }
  points.push([nx, ny])
  return points
}

/** Calls `handle` for each line, decoding a few megabytes at a time. */
function forEachLine(bytes: Uint8Array, handle: (line: string) => void) {
  const decoder = new TextDecoder()
  const block = 4 * 1024 * 1024
  let start = 0
  while (start < bytes.length) {
    let end = Math.min(bytes.length, start + block)
    if (end < bytes.length) {
      const newline = bytes.lastIndexOf(10, end)
      if (newline > start) end = newline + 1
    }
    const text = decoder.decode(bytes.subarray(start, end))
    let at = 0
    while (at < text.length) {
      let next = text.indexOf('\n', at)
      if (next === -1) next = text.length
      handle(text.slice(at, next))
      at = next + 1
    }
    start = end
  }
}
