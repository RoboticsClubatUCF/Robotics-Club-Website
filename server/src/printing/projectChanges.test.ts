import { readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { changedKeys, markChangedSettings } from './projectChanges.js'
import { readSlicedProject } from './sliceArchive.js'

// A 20 mm cube the worker sliced with Orca 2.4.2, whose CLI writes the list empty.
const fixture = new Uint8Array(
  readFileSync(new URL('./fixtures/sliced-cube.3mf', import.meta.url)),
)

const settingsOf = (bytes: Uint8Array) =>
  JSON.parse(strFromU8(unzipSync(bytes)['Metadata/project_settings.config']!)) as Record<
    string,
    unknown
  >

describe('changedKeys', () => {
  it('names keys that differ from the stock parent, and only those', () => {
    const project = { wall_loops: '6', layer_height: '0.2', sparse_infill_density: '15%' }
    const own = { ...project, name: 'Club', inherits: '0.20mm Standard' }
    const parent = { wall_loops: '2', layer_height: '0.20', sparse_infill_density: '15%' }
    expect(changedKeys(project, own, parent)).toEqual(['wall_loops'])
  })

  it("names a member's setting even when the club profile doesn't carry it", () => {
    const project = { wall_loops: '2', brim_width: '8' }
    expect(changedKeys(project, { wall_loops: '2' }, { wall_loops: '2' }, ['brim_width'])).toEqual([
      'brim_width',
    ])
  })

  it('compares vectors whole and names keys the parent lacks', () => {
    const project = { nozzle_temperature: ['215'], machine_start_gcode: 'G28\nM104', extra: '1' }
    const parent = { nozzle_temperature: ['220'], machine_start_gcode: 'G28\nM104' }
    expect(changedKeys(project, project, parent)).toEqual(['extra', 'nozzle_temperature'])
  })

  it("compares with Orca's stock export rather than the stock file", () => {
    // The stock file has one value where Orca writes two; Orca's export has the same two.
    const project = { machine_max_jerk_x: ['9', '9'], wall_loops: '6' }
    const parent = { machine_max_jerk_x: ['9'], wall_loops: '2' }
    const stock = { machine_max_jerk_x: ['9', '9'], wall_loops: '2' }
    expect(changedKeys(project, project, parent, [], stock)).toEqual(['wall_loops'])
    expect(changedKeys(project, project, parent)).toEqual(['machine_max_jerk_x', 'wall_loops'])
  })

  it('names every setting when there is no stock parent', () => {
    expect(changedKeys({ a: '1', b: '2', name: 'x' }, { a: '1', b: '2', name: 'x' }, null)).toEqual([
      'a',
      'b',
    ])
  })
})

describe('markChangedSettings', () => {
  const project = settingsOf(fixture)
  const marked = markChangedSettings(fixture, {
    process: {
      own: { wall_loops: project['wall_loops'], inherits: 'stock' },
      parent: { wall_loops: '99' },
      extra: ['sparse_infill_density'],
    },
    filament: { own: { nozzle_temperature: project['nozzle_temperature'] }, parent: null },
    printer: {
      own: { printable_height: project['printable_height'] },
      parent: { printable_height: project['printable_height'] },
    },
    stock: null,
  })

  it('fills in process, filament and printer lists', () => {
    expect(settingsOf(fixture)['different_settings_to_system']).toEqual(['', '', ''])
    expect(settingsOf(marked)['different_settings_to_system']).toEqual([
      'sparse_infill_density;wall_loops',
      'nozzle_temperature',
      '',
    ])
  })

  it('changes nothing else in the project', () => {
    const { different_settings_to_system: _a, ...before } = settingsOf(fixture)
    const { different_settings_to_system: _b, ...after } = settingsOf(marked)
    expect(after).toEqual(before)
    const files = unzipSync(fixture)
    const out = unzipSync(marked)
    expect(Object.keys(out)).toEqual(Object.keys(files))
    expect(out['Metadata/plate_1.gcode']).toEqual(files['Metadata/plate_1.gcode'])
  })

  it('still reads back as a good slice', () => {
    expect(() =>
      readSlicedProject(marked, {
        objects: 1,
        meshes: 1,
        printer: 'CC1',
        process: '0.20mm, 0.4 nozzle, Line, T-Support',
        filament: 'Elegoo Rapid PLA',
        bedType: 'Textured PEI Plate',
        overrides: {},
      }),
    ).not.toThrow()
  })
})
