import { gunzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { PreviewError, ROLES, buildPreview, roleOf } from './gcodePreview.js'

const bed = { width: 256, depth: 256, height: 256 }
const limits = { maxSegments: 1_000_000, maxBytes: 8 * 1024 * 1024 }

/** Just enough of web/src/lib/slicer/preview.ts to check what was written. */
function read(bytes: Uint8Array) {
  const raw = gunzipSync(bytes)
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  let at = 52
  const varint = () => {
    let value = 0
    let shift = 1
    for (;;) {
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
  const layers = []
  const count = view.getUint32(20, true)
  let x = 0
  let y = 0
  for (let l = 0; l < count; l++) {
    const z = view.getFloat32(at, true)
    at += 8
    const paths = []
    const pathCount = varint()
    for (let p = 0; p < pathCount; p++) {
      const role = ROLES[raw[at++]!]
      const points: [number, number][] = []
      const n = varint()
      for (let i = 0; i < n; i++) {
        x += zigzag()
        y += zigzag()
        points.push([x / 100, y / 100])
      }
      paths.push({ role, points })
    }
    layers.push({ z, paths })
  }
  return {
    magic: String.fromCharCode(...raw.subarray(0, 4)),
    segments: view.getUint32(24, true),
    bounds: [0, 1, 2, 3, 4, 5].map((i) => view.getFloat32(28 + i * 4, true)),
    layers,
  }
}

const gcode = (body: string) => new TextEncoder().encode(body)

const twoLayers = `; total layer number: 2
G90
M83
G1 X10 Y10 F3000
;LAYER_CHANGE
;Z:0.2
;HEIGHT:0.2
;TYPE:Outer wall
G1 X20 Y10 E1
G1 X20 Y20 E1
G1 X25 Y25
;TYPE:Sparse infill
G1 X30 Y25 E0.5
;LAYER_CHANGE
;Z:0.4
;HEIGHT:0.2
;TYPE:Support
G1 X10 Y10 E0.5 ; a comment with X99 in it
`

describe('buildPreview', () => {
  it('writes layers, roles and paths, breaking at travel', () => {
    const preview = buildPreview(gcode(twoLayers), bed, limits)
    expect(preview.layers).toBe(2)
    expect(preview.segments).toBe(4)
    const decoded = read(preview.bytes)
    expect(decoded.magic).toBe('RCPV')
    expect(decoded.layers[0]!.z).toBeCloseTo(0.2)
    expect(decoded.layers[0]!.paths.map((p) => p.role)).toEqual(['outerWall', 'sparseInfill'])
    expect(decoded.layers[0]!.paths[0]!.points).toEqual([
      [10, 10],
      [20, 10],
      [20, 20],
    ])
    expect(decoded.layers[1]!.paths[0]).toEqual({
      role: 'support',
      points: [
        [30, 25],
        [10, 10],
      ],
    })
    expect(decoded.bounds[0]).toBe(10)
    expect(decoded.bounds[3]).toBe(30)
    expect(decoded.bounds[5]).toBeCloseTo(0.4)
  })

  it('cuts arcs into chords that stay on the circle', () => {
    const arc = ';LAYER_CHANGE\n;Z:0.2\n;TYPE:Outer wall\nG1 X60 Y50\nG3 X40 Y50 I-10 J0 E2\n'
    const { layers } = read(buildPreview(gcode(arc), bed, limits).bytes)
    const points = layers[0]!.paths[0]!.points
    expect(points.length).toBeGreaterThan(10)
    for (const [px, py] of points) expect(Math.hypot(px - 50, py - 50)).toBeCloseTo(10, 1)
    expect(points.at(-1)).toEqual([40, 50])
    // Counter-clockwise from (60, 50) to (40, 50) goes over the top.
    expect(Math.max(...points.map(([, py]) => py))).toBeCloseTo(60, 1)
  })

  it('reads absolute extrusion too', () => {
    const absolute = ';LAYER_CHANGE\n;Z:0.2\nM82\nG92 E0\nG1 X0 Y0\nG1 X10 Y0 E1\nG1 X10 Y10 E1\nG1 X0 Y10 E2\n'
    expect(buildPreview(gcode(absolute), bed, limits).segments).toBe(2)
  })

  it('refuses G-code whose layers disagree with its header', () => {
    const wrong = twoLayers.replace('number: 2', 'number: 3')
    expect(() => buildPreview(gcode(wrong), bed, limits)).toThrow(
      PreviewError,
    )
  })

  it('stops at the segment cap', () => {
    expect(() => buildPreview(gcode(twoLayers), bed, { ...limits, maxSegments: 2 })).toThrow(
      'too detailed',
    )
  })
})

describe('roleOf', () => {
  it('sorts Orca feature names into the preview roles', () => {
    expect(roleOf('Outer wall')).toBe('outerWall')
    expect(roleOf('Overhang wall')).toBe('outerWall')
    expect(roleOf('Inner wall')).toBe('innerWall')
    expect(roleOf('Sparse infill')).toBe('sparseInfill')
    expect(roleOf('Internal solid infill')).toBe('solidInfill')
    expect(roleOf('Top surface')).toBe('solidInfill')
    expect(roleOf('Bridge')).toBe('solidInfill')
    expect(roleOf('Support interface')).toBe('support')
    expect(roleOf('Skirt')).toBe('other')
    expect(roleOf('Brim')).toBe('other')
  })
})
