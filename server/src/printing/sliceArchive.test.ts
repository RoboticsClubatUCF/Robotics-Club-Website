import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildPreview } from './gcodePreview.js'
import { ArchiveError, type Expected, readSlicedProject } from './sliceArchive.js'

// A 20 mm cube the worker sliced with Orca 2.4.2: PLA, the Standard preset, nothing changed.
const fixture = new Uint8Array(readFileSync(new URL('./fixtures/sliced-cube.3mf', import.meta.url)))

const expected: Expected = {
  objects: 1,
  meshes: 1,
  printer: 'CC1',
  process: '0.20mm, 0.4 nozzle, Line, T-Support',
  filament: 'Elegoo Rapid PLA',
  bedType: 'Textured PEI Plate',
  overrides: {},
}

describe('readSlicedProject', () => {
  it("reads Orca's estimate and the plate's G-code", () => {
    const summary = readSlicedProject(fixture, expected)
    expect(summary.grams).toBeCloseTo(3.5, 0)
    expect(summary.seconds).toBeGreaterThan(60)
    expect(summary.meters).toBeGreaterThan(0)
    expect(summary.gcode.byteLength).toBeGreaterThan(1000)
  })

  it('previews the real G-code with every layer Orca declared', () => {
    const { gcode } = readSlicedProject(fixture, expected)
    const preview = buildPreview(
      gcode,
      { width: 256, depth: 256, height: 256 },
      { maxSegments: 4_000_000, maxBytes: 8 * 1024 * 1024 },
    )
    expect(preview.layers).toBe(100)
  })

  it('compares numbers as numbers', () => {
    expect(() =>
      readSlicedProject(fixture, {
        ...expected,
        overrides: { wall_loops: '2', top_shell_thickness: '1.0' },
      }),
    ).not.toThrow()
  })

  it('refuses a project sliced with other settings', () => {
    expect(() =>
      readSlicedProject(fixture, { ...expected, overrides: { wall_loops: '5' } }),
    ).toThrow(ArchiveError)
    expect(() =>
      readSlicedProject(fixture, { ...expected, filament: 'Elegoo RAPID PETG Optimized' }),
    ).toThrow(/filament_settings_id/)
  })

  it('refuses a plate missing objects or meshes', () => {
    let caught: unknown
    try {
      readSlicedProject(fixture, { ...expected, objects: 2 })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ArchiveError)
    expect((caught as ArchiveError).reason).toBe('doesntFit')
    expect(() => readSlicedProject(fixture, { ...expected, meshes: 2 })).toThrow(/meshes/)
  })
})
