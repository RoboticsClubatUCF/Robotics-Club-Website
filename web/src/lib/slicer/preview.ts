/**
 * Reading the sliced plate's layer preview, which the worker writes from Orca's own G-code
 * (`server/src/printing/gcodePreview.ts` describes the format, "RCPV" 1).
 *
 * Decoded into one line list per role, with each layer's start, so the viewer can show a range of
 * layers by moving a draw range instead of rebuilding geometry.
 */

export const ROLES = ['outerWall', 'innerWall', 'sparseInfill', 'solidInfill', 'support', 'other'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABEL: Record<Role, string> = {
  outerWall: 'Outer wall',
  innerWall: 'Inner wall',
  sparseInfill: 'Sparse infill',
  solidInfill: 'Solid infill',
  support: 'Support',
  other: 'Skirt, brim, purge',
}

export interface RoleLines {
  /** Line segments, six floats each: x1 y1 z1 x2 y2 z2. */
  positions: Float32Array
  /** Segment index where each layer starts, plus the total at the end. */
  layerStart: Uint32Array
}

export interface Preview {
  bed: { width: number; depth: number; height: number }
  layers: { z: number; height: number }[]
  segments: number
  bounds: { min: [number, number, number]; max: [number, number, number] }
  roles: Record<Role, RoleLines>
}

export class PreviewError extends Error {}

/** Gunzips with the browser's own decompressor. */
export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export function parsePreview(raw: Uint8Array): Preview {
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  const magic = String.fromCharCode(raw[0]!, raw[1]!, raw[2]!, raw[3]!)
  if (magic !== 'RCPV' || raw[4] !== 1) throw new PreviewError(`This preview is in a format the page doesn't read.`)

  const f32 = (at: number) => view.getFloat32(at, true)
  const bed = { width: f32(8), depth: f32(12), height: f32(16) }
  const layerCount = view.getUint32(20, true)
  const segments = view.getUint32(24, true)
  const bounds = {
    min: [f32(28), f32(32), f32(36)] as [number, number, number],
    max: [f32(40), f32(44), f32(48)] as [number, number, number],
  }

  let at = 52
  const varint = () => {
    let value = 0
    let shift = 1
    for (;;) {
      if (at >= raw.length) throw new PreviewError('The preview ends early.')
      const byte = raw[at++]!
      value += (byte & 0x7f) * shift
      if (byte < 0x80) return value
      shift *= 128
    }
  }
  const zigzag = () => {
    const v = varint()
    return v % 2 ? -(v + 1) / 2 : v / 2
  }

  // Two passes would avoid growing arrays; one pass with growable buffers is simpler and the
  // segment count is known up front, so each role's buffer is sized from it.
  const buffers = ROLES.map(() => ({ data: new Float32Array(1024), length: 0 }))
  const starts = ROLES.map(() => new Uint32Array(layerCount + 1))
  const push = (role: number, values: number[]) => {
    const buffer = buffers[role]!
    if (buffer.length + values.length > buffer.data.length) {
      let size = buffer.data.length * 2
      while (size < buffer.length + values.length) size *= 2
      const next = new Float32Array(Math.min(size, Math.max(segments * 6, buffer.length + values.length)))
      next.set(buffer.data.subarray(0, buffer.length))
      buffer.data = next
    }
    buffer.data.set(values, buffer.length)
    buffer.length += values.length
  }

  const layers: Preview['layers'] = []
  let x = 0
  let y = 0
  for (let l = 0; l < layerCount; l++) {
    const z = f32(at)
    const height = f32(at + 4)
    at += 8
    layers.push({ z, height })
    ROLES.forEach((_, role) => {
      starts[role]![l] = buffers[role]!.length / 6
    })
    const paths = varint()
    for (let p = 0; p < paths; p++) {
      const role = raw[at++]!
      if (role >= ROLES.length) throw new PreviewError(`The preview names a role the page doesn't know.`)
      const points = varint()
      let px = 0
      let py = 0
      for (let i = 0; i < points; i++) {
        x += zigzag()
        y += zigzag()
        const nx = x / 100
        const ny = y / 100
        if (i > 0) push(role, [px, py, z, nx, ny, z])
        px = nx
        py = ny
      }
    }
  }
  ROLES.forEach((_, role) => {
    starts[role]![layerCount] = buffers[role]!.length / 6
  })

  const roles = Object.fromEntries(
    ROLES.map((name, role) => [
      name,
      { positions: buffers[role]!.data.slice(0, buffers[role]!.length), layerStart: starts[role]! },
    ]),
  ) as Record<Role, RoleLines>

  return { bed, layers, segments, bounds, roles }
}
