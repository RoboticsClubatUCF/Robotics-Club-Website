/**
 * Reading the sliced plate's layer preview, which the worker writes from Orca's own G-code
 * (`server/src/printing/gcodePreview.ts` describes the format, "RCPV" 2, and reads 1).
 *
 * Decoded into one segment list per role, with each layer's start, so the viewer can show the
 * layers up to one by drawing a count of segments instead of rebuilding anything.
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

/** Floats per segment in `RoleLines.segments`. */
export const SEGMENT_FLOATS = 8
/**
 * `RoleLines.segments` is padded to whole rows of this many, because the viewer uploads it to the
 * GPU as a texture that wide and a texture can't end partway through a row.
 */
export const SEGMENTS_PER_ROW = 2048

/**
 * The sharpest half-turn drawn as a mitre, in radians: a mitre's length grows as 1 / cos of it,
 * so past a 120 degree turn the path is drawn as if it stopped there and started again.
 */
export const MITRE_LIMIT = Math.PI / 3
/** Codes for a mitre's angle run 1 to this; 0 is an end the path stops at. */
export const MITRE_STEPS = 4095

/** The code for a mitre `angle` radians from a segment's own direction, between ±`MITRE_LIMIT`. */
export function mitreCode(angle: number): number {
  return 1 + Math.round(((angle / MITRE_LIMIT + 1) / 2) * (MITRE_STEPS - 1))
}

/** The angle a mitre code stands for, or null for an end the path stops at. */
export function mitreAngle(code: number): number | null {
  return code === 0 ? null : (((code - 1) / (MITRE_STEPS - 1)) * 2 - 1) * MITRE_LIMIT
}

export interface RoleLines {
  /**
   * Line segments, eight floats each: x1 y1 x2 y2, z (the nozzle's, the top of the line), line
   * width, layer height, and how each end meets the path's next segment: the start's mitre code
   * plus 4096 times the end's. Worked out here, once, so the GPU never reads a neighbour. Padded
   * with zeros to whole rows of `SEGMENTS_PER_ROW`.
   */
  segments: Float32Array
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

/** Version 1 didn't say how wide a line was. Orca's outer wall width is the closest guess. */
const DEFAULT_WIDTH = 0.42

/** A float array that grows as it's filled, but never past what `cap` floats need. */
function growable(cap: number) {
  let data = new Float32Array(Math.min(1024, Math.max(cap, 1)))
  let length = 0
  return {
    push(...values: number[]) {
      if (length + values.length > data.length) {
        let size = data.length * 2
        while (size < length + values.length) size *= 2
        const next = new Float32Array(Math.min(size, Math.max(cap, length + values.length)))
        next.set(data.subarray(0, length))
        data = next
      }
      data.set(values, length)
      length += values.length
    },
    get length() {
      return length
    },
    set(index: number, value: number) {
      data[index] = value
    },
    /** What was pushed, with zeros after it up to a whole number of `multiple` floats. */
    done(multiple: number) {
      const out = new Float32Array(Math.ceil(length / multiple) * multiple)
      out.set(data.subarray(0, length))
      return out
    },
  }
}

export function parsePreview(raw: Uint8Array): Preview {
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  const magic = String.fromCharCode(raw[0]!, raw[1]!, raw[2]!, raw[3]!)
  const version = raw[4]
  if (magic !== 'RCPV' || (version !== 1 && version !== 2)) {
    throw new PreviewError(`This preview is in a format the page doesn't read.`)
  }

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
  // segment count is known up front, so no buffer outgrows the whole plate.
  const lines = ROLES.map(() => growable(segments * SEGMENT_FLOATS))
  const starts = ROLES.map(() => new Uint32Array(layerCount + 1))

  const layers: Preview['layers'] = []
  let x = 0
  let y = 0
  let below = 0
  for (let l = 0; l < layerCount; l++) {
    const z = f32(at)
    const height = f32(at + 4)
    at += 8
    layers.push({ z, height })
    // Orca says each layer's height; without it, the gap down to the layer below.
    const thickness = height > 0 ? height : Math.max(0.05, z - below)
    below = z
    ROLES.forEach((_, role) => {
      starts[role]![l] = lines[role]!.length / SEGMENT_FLOATS
    })
    const paths = varint()
    for (let p = 0; p < paths; p++) {
      const role = raw[at++]!
      if (role >= ROLES.length) throw new PreviewError(`The preview names a role the page doesn't know.`)
      const width = version === 1 ? DEFAULT_WIDTH : varint() / 100
      const points = varint()
      const line = lines[role]!
      let px = 0
      let py = 0
      // The path's last segment so far: its direction and its start's mitre code.
      let last: { heading: number; start: number } | null = null
      for (let i = 0; i < points; i++) {
        x += zigzag()
        y += zigzag()
        const nx = x / 100
        const ny = y / 100
        // A segment with no length has no direction to draw along; version 1 files have some.
        if (i > 0 && (nx !== px || ny !== py)) {
          const heading = Math.atan2(ny - py, nx - px)
          let start = 0
          if (last) {
            // The joint's plane is halfway between the two directions; each segment's mitre is
            // its angle from that segment's own direction.
            const turn = Math.atan2(Math.sin(heading - last.heading), Math.cos(heading - last.heading))
            if (Math.abs(turn / 2) < MITRE_LIMIT) {
              start = mitreCode(-turn / 2)
              line.set(line.length - 1, last.start + 4096 * mitreCode(turn / 2))
            }
          }
          line.push(px, py, nx, ny, z, width, thickness, start)
          last = { heading, start }
        }
        px = nx
        py = ny
      }
    }
  }
  ROLES.forEach((_, role) => {
    starts[role]![layerCount] = lines[role]!.length / SEGMENT_FLOATS
  })

  const roles = Object.fromEntries(
    ROLES.map((name, role) => [
      name,
      { segments: lines[role]!.done(SEGMENTS_PER_ROW * SEGMENT_FLOATS), layerStart: starts[role]! },
    ]),
  ) as Record<Role, RoleLines>

  return { bed, layers, segments, bounds, roles }
}
