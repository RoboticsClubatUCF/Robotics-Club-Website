import { describe, expect, it } from 'vitest'
import { SLICED_CUBE_PREVIEW } from './fixtures/slicedCubePreview'
import { PreviewError, ROLES, parsePreview } from './preview'

const fixture = Uint8Array.from(atob(SLICED_CUBE_PREVIEW), (c) => c.charCodeAt(0))

describe('parsePreview', () => {
  it('reads every layer Orca printed, as line segments by role', () => {
    const preview = parsePreview(fixture)
    expect(preview.layers).toHaveLength(100)
    expect(preview.layers[0]!.z).toBeCloseTo(0.2)
    expect(preview.layers[99]!.z).toBeCloseTo(20, 1)
    expect(preview.bed).toEqual({ width: 256, depth: 256, height: 256 })

    const walls = preview.roles.outerWall
    expect(walls.positions.length).toBeGreaterThan(0)
    expect(walls.layerStart).toHaveLength(101)
    expect(walls.layerStart[100]).toBe(walls.positions.length / 6)
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
    const total = ROLES.reduce((sum, role) => sum + preview.roles[role].positions.length / 6, 0)
    expect(total).toBe(preview.segments)
  })

  it('refuses something that isn’t a preview', () => {
    expect(() => parsePreview(new TextEncoder().encode('not a preview at all, no'))).toThrow(PreviewError)
  })
})
