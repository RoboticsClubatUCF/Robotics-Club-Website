import { describe, expect, it } from 'vitest'
import { SLICED_CUBE_PREVIEW } from './fixtures/slicedCubePreview'
import {
  MITRE_LIMIT,
  PreviewError,
  ROLES,
  SEGMENTS_PER_ROW,
  SEGMENT_FLOATS,
  mitreAngle,
  mitreCode,
  parsePreview,
} from './preview'

const fixture = Uint8Array.from(atob(SLICED_CUBE_PREVIEW), (c) => c.charCodeAt(0))

describe('parsePreview', () => {
  it('reads every layer Orca printed, as line segments by role', () => {
    const preview = parsePreview(fixture)
    expect(preview.layers).toHaveLength(100)
    expect(preview.layers[0]!.z).toBeCloseTo(0.2)
    expect(preview.layers[99]!.z).toBeCloseTo(20, 1)
    expect(preview.bed).toEqual({ width: 256, depth: 256, height: 256 })

    const walls = preview.roles.outerWall
    expect(walls.layerStart).toHaveLength(101)
    expect(walls.layerStart[100]).toBeGreaterThan(0)
    // Every layer start is no later than the next.
    for (let l = 0; l < 100; l++) expect(walls.layerStart[l]!).toBeLessThanOrEqual(walls.layerStart[l + 1]!)
  })

  it('puts the cube where it was placed: 118 to 138 mm across', () => {
    const { bounds } = parsePreview(fixture)
    expect(bounds.min[0]).toBeCloseTo(118, 0)
    expect(bounds.max[0]).toBeCloseTo(138, 0)
    expect(bounds.min[1]).toBeCloseTo(118, 0)
  })

  it('counts every segment once', () => {
    const preview = parsePreview(fixture)
    const total = ROLES.reduce((sum, role) => sum + preview.roles[role].layerStart.at(-1)!, 0)
    expect(total).toBe(preview.segments)
  })

  it('pads each role to whole texture rows, with nothing past its last segment', () => {
    const { roles } = parsePreview(fixture)
    for (const role of ROLES) {
      const { segments, layerStart } = roles[role]
      const count = layerStart.at(-1)!
      expect(segments.length).toBe(Math.ceil(count / SEGMENTS_PER_ROW) * SEGMENTS_PER_ROW * SEGMENT_FLOATS)
      expect(segments.subarray(count * SEGMENT_FLOATS).every((value) => value === 0)).toBe(true)
    }
  })

  it('gives each segment the width Orca printed it at and its layer’s height', () => {
    const { roles } = parsePreview(fixture)
    // Standard prints the first layer at 0.5 mm and then the outer wall at 0.42, the inner at 0.45.
    const first = (role: 'outerWall' | 'innerWall', layer: number) => {
      const at = roles[role].layerStart[layer]! * SEGMENT_FLOATS
      return [roles[role].segments[at + 5]!, roles[role].segments[at + 6]!]
    }
    expect(first('outerWall', 0)[0]).toBeCloseTo(0.5)
    expect(first('outerWall', 5)[0]).toBeCloseTo(0.42)
    expect(first('innerWall', 5)[0]).toBeCloseTo(0.45)
    expect(first('outerWall', 5)[1]).toBeCloseTo(0.2)
  })

  it('still reads version 1, which had no widths', () => {
    // One layer at 0.2 mm holding one outer wall from (0, 0) to (10, 0).
    const raw = new Uint8Array(68)
    const view = new DataView(raw.buffer)
    raw.set([82, 67, 80, 86, 1])
    view.setUint32(20, 1, true)
    view.setUint32(24, 1, true)
    view.setFloat32(52, 0.2, true)
    view.setFloat32(56, 0.2, true)
    // One path, role 0, two points: (0, 0), then x +1000 (zigzag 2000 as a varint), y +0.
    raw.set([1, 0, 2, 0, 0, 0xd0, 0x0f, 0], 60)
    const preview = parsePreview(raw)
    const segment = Array.from(preview.roles.outerWall.segments.subarray(0, SEGMENT_FLOATS))
    expect(segment).toEqual([0, 0, 10, 0, expect.closeTo(0.2), expect.closeTo(0.42), expect.closeTo(0.2), 0])
  })

  it('mitres a path’s turn halfway, and leaves out segments with no length', () => {
    // Version 2, one layer, one outer wall at 0.45 mm: (0, 0) → (10, 0) → (10, 0) again → (10, 10).
    const raw = new Uint8Array(74)
    const view = new DataView(raw.buffer)
    raw.set([82, 67, 80, 86, 2])
    view.setUint32(20, 1, true)
    view.setUint32(24, 3, true)
    view.setFloat32(52, 0.2, true)
    view.setFloat32(56, 0.2, true)
    raw.set([1, 0, 45, 4, 0, 0, 0xd0, 0x0f, 0, 0, 0, 0, 0xd0, 0x0f], 60)
    const { segments, layerStart } = parsePreview(raw).roles.outerWall
    expect(layerStart.at(-1)).toBe(2)
    const segment = (s: number) => Array.from(segments.subarray(s * SEGMENT_FLOATS, (s + 1) * SEGMENT_FLOATS))
    // A left turn of 90 degrees: the first segment stops at 45 degrees left of its own direction,
    // the second starts at 45 right of its own, and the path's two far ends stop.
    expect(segment(0)).toEqual([0, 0, 10, 0, expect.closeTo(0.2), expect.closeTo(0.45), expect.closeTo(0.2), 4096 * mitreCode(Math.PI / 4)])
    expect(segment(1)).toEqual([10, 0, 10, 10, expect.closeTo(0.2), expect.closeTo(0.45), expect.closeTo(0.2), mitreCode(-Math.PI / 4)])
  })

  it('keeps a mitre’s angle to a hundredth of a degree, and stops a path at a hairpin', () => {
    for (const angle of [-MITRE_LIMIT, -0.3, 0, 0.0001, Math.PI / 4, MITRE_LIMIT]) {
      expect(Math.abs(mitreAngle(mitreCode(angle))! - angle)).toBeLessThan((0.03 * Math.PI) / 180)
    }
    expect(mitreAngle(0)).toBeNull()
    // Ending at the next code up keeps start and end apart within a float's exact integers.
    expect(mitreCode(MITRE_LIMIT) + 4096 * mitreCode(MITRE_LIMIT)).toBeLessThan(2 ** 24)

    // (0, 0) → (10, 0) → (0, 0.5): a turn of nearly 180 degrees, too sharp to mitre.
    const raw = new Uint8Array(72)
    const view = new DataView(raw.buffer)
    raw.set([82, 67, 80, 86, 2])
    view.setUint32(20, 1, true)
    view.setUint32(24, 2, true)
    view.setFloat32(52, 0.2, true)
    view.setFloat32(56, 0.2, true)
    // x -1000 is zigzag 1999 (0xcf 0x0f); y +50 is zigzag 100.
    raw.set([1, 0, 45, 3, 0, 0, 0xd0, 0x0f, 0, 0xcf, 0x0f, 100], 60)
    const { segments } = parsePreview(raw).roles.outerWall
    expect(segments[7]).toBe(0)
    expect(segments[SEGMENT_FLOATS + 7]).toBe(0)
  })

  it('refuses something that isn’t a preview', () => {
    expect(() => parsePreview(new TextEncoder().encode('not a preview at all, no'))).toThrow(PreviewError)
  })
})
