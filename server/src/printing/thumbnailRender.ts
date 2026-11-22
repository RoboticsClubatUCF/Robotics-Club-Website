import { crc32, deflateSync } from 'node:zlib'
import type { Affine } from './plateTransform.js'

/**
 * Draws a print's parts to a PNG. A software z-buffer rather than a headless GL: the API has no
 * GPU, and at this size a rasterizer and a PNG writer are all it takes. Runs in
 * `thumbnailWorker.ts`, never on the API's event loop.
 */

export const THUMBNAIL_SIZE = 256

/** Past this, every nth triangle is drawn. They're well under a pixel by then. */
const MAX_DRAWN_TRIANGLES = 1_500_000

type Vec = [number, number, number]

const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const unit = (a: Vec): Vec => {
  const length = Math.hypot(...a) || 1
  return [a[0] / length, a[1] / length, a[2] / length]
}

// From above the plate's front right corner, the side facing the printer's door.
const TO_VIEWER = unit([0.65, -0.8, 0.6])
const RIGHT = unit(cross([0, 0, 1], TO_VIEWER))
const UP = cross(TO_VIEWER, RIGHT)
const LIGHT = unit([0.2, -0.55, 0.8])

const place = (affine: Affine, p: Float32Array, i: number): Vec => {
  const { m, t } = affine
  const x = p[i]!
  const y = p[i + 1]!
  const z = p[i + 2]!
  return [
    m[0] * x + m[1] * y + m[2] * z + t[0],
    m[3] * x + m[4] * y + m[5] * z + t[1],
    m[6] * x + m[7] * y + m[8] * z + t[2],
  ]
}

export interface ThumbnailMesh {
  positions: Float32Array
  /** One per copy on the plate. */
  affines: Affine[]
}

/** The parts, framed to fill the picture, on a transparent background for either theme. */
export function renderThumbnail(meshes: ThumbnailMesh[], size = THUMBNAIL_SIZE): Uint8Array {
  const total = meshes.reduce(
    (sum, mesh) => sum + (mesh.positions.length / 9) * mesh.affines.length,
    0,
  )
  const stride = Math.max(1, Math.ceil(total / MAX_DRAWN_TRIANGLES))

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const { positions, affines } of meshes) {
    for (const affine of affines) {
      for (let i = 0; i < positions.length; i += 3) {
        const point = place(affine, positions, i)
        const x = dot(point, RIGHT)
        const y = dot(point, UP)
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  // Drawn at twice the size and averaged down, for clean edges.
  const samples = size * 2
  const margin = samples * 0.05
  const scale = (samples - margin * 2) / Math.max(maxX - minX, maxY - minY, 1e-6)
  const midX = (minX + maxX) / 2
  const midY = (minY + maxY) / 2
  const depth = new Float32Array(samples * samples).fill(-Infinity)
  const shade = new Uint8Array(samples * samples)

  const drawTriangle = (a: Vec, b: Vec, c: Vec) => {
    const ax = (dot(a, RIGHT) - midX) * scale + samples / 2
    const ay = samples / 2 - (dot(a, UP) - midY) * scale
    const bx = (dot(b, RIGHT) - midX) * scale + samples / 2
    const by = samples / 2 - (dot(b, UP) - midY) * scale
    const cx = (dot(c, RIGHT) - midX) * scale + samples / 2
    const cy = samples / 2 - (dot(c, UP) - midY) * scale
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    if (area === 0) return

    const az = dot(a, TO_VIEWER)
    const bz = dot(b, TO_VIEWER)
    const cz = dot(c, TO_VIEWER)

    // Turned to face the viewer, because plenty of STLs have their winding backwards.
    let normal = unit(
      cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]),
    )
    if (dot(normal, TO_VIEWER) < 0) normal = [-normal[0], -normal[1], -normal[2]]
    // Capped below white so a top face still shows on the light theme's well.
    const tone = Math.round(64 + 130 * Math.max(0, dot(normal, LIGHT)))

    const top = Math.max(0, Math.ceil(Math.min(ay, by, cy) - 0.5))
    const bottom = Math.min(samples - 1, Math.floor(Math.max(ay, by, cy) - 0.5))
    const edges = [ax, ay, bx, by, bx, by, cx, cy, cx, cy, ax, ay]

    for (let y = top; y <= bottom; y++) {
      const py = y + 0.5

      // Only the row's span inside the triangle, so a long diagonal sliver costs its own pixels
      // and not its whole bounding box.
      let from = Infinity
      let to = -Infinity
      for (let e = 0; e < 12; e += 4) {
        const y0 = edges[e + 1]!
        const y1 = edges[e + 3]!
        if ((py < y0 && py < y1) || (py > y0 && py > y1) || y0 === y1) continue
        const x = edges[e]! + ((py - y0) * (edges[e + 2]! - edges[e]!)) / (y1 - y0)
        if (x < from) from = x
        if (x > to) to = x
      }
      const left = Math.max(0, Math.ceil(from - 0.5))
      const right = Math.min(samples - 1, Math.floor(to - 0.5))

      for (let x = left; x <= right; x++) {
        const px = x + 0.5
        const u = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area
        const v = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area
        const z = u * az + v * bz + (1 - u - v) * cz
        const at = y * samples + x
        if (z > depth[at]!) {
          depth[at] = z
          shade[at] = tone
        }
      }
    }
  }

  for (const { positions, affines } of meshes) {
    for (const affine of affines) {
      for (let i = 0; i < positions.length; i += 9 * stride) {
        drawTriangle(
          place(affine, positions, i),
          place(affine, positions, i + 3),
          place(affine, positions, i + 6),
        )
      }
    }
  }

  const rgba = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0
      let covered = 0
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const tone = shade[(y * 2 + dy) * samples + x * 2 + dx]!
          if (tone > 0) {
            sum += tone
            covered++
          }
        }
      }
      if (covered === 0) continue
      const at = (y * size + x) * 4
      const gray = Math.round(sum / covered)
      rgba[at] = gray
      rgba[at + 1] = gray
      rgba[at + 2] = gray
      rgba[at + 3] = Math.round((covered / 4) * 255)
    }
  }
  return encodePng(rgba, size)
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const name = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const check = Buffer.alloc(4)
  check.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([length, name, data, check])
}

function encodePng(rgba: Uint8Array, size: number): Uint8Array {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bits per channel
  header[9] = 6 // RGBA

  const rows = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    // Each row starts with its filter byte, left at 0 (none).
    rows.set(rgba.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(rows)),
    pngChunk('IEND', new Uint8Array()),
  ])
}
