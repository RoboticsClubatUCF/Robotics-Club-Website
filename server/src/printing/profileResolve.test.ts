import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ProfileError,
  StockProfiles,
  fitsPrinter,
  printerInfo,
  resolvePreset,
} from './profileResolve.js'

/**
 * Flattening against a small fake `resources/profiles`. The real one, and Orca itself, are in
 * `sliceSmoke.ts` inside the worker image; this is the part the server job can check.
 */

let root: string
let stock: StockProfiles

const PRINTER = {
  name: 'Acme One 0.4 nozzle',
  inherits: 'fdm_machine_common',
  printer_technology: 'FFF',
  printable_area: ['0x0', '200x0', '200x200', '0x200'],
  printable_height: '180',
  nozzle_diameter: ['0.4'],
  min_layer_height: ['0.08'],
  max_layer_height: ['0.28'],
  default_bed_type: '4',
  printer_model: 'Acme One',
  print_host: '192.168.1.20',
  setting_id: 'GM001',
}

async function vendor(name: string, lists: Record<string, [string, object][]>) {
  const index: Record<string, { name: string; sub_path: string }[]> = {}
  for (const [list, profiles] of Object.entries(lists)) {
    index[list] = []
    for (const [path, profile] of profiles) {
      await mkdir(join(root, name, path, '..'), { recursive: true })
      await writeFile(join(root, name, path), JSON.stringify(profile))
      index[list].push({ name: (profile as { name: string }).name, sub_path: path })
    }
  }
  await writeFile(join(root, `${name}.json`), JSON.stringify({ name, ...index }))
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'rccf-stock-'))
  // Both vendors have their own `fdm_machine_common`; a parent is found in its child's vendor.
  await vendor('Acme', {
    machine_list: [
      ['machine/fdm_machine_common.json', { name: 'fdm_machine_common', gcode_flavor: 'klipper' }],
      ['machine/Acme One 0.4 nozzle.json', PRINTER],
    ],
    filament_list: [
      ['filament/Generic PLA @Acme.json', { name: 'Generic PLA @Acme', filament_type: ['PLA'], nozzle_temperature: ['210'] }],
    ],
  })
  await vendor('Other', {
    machine_list: [['machine/fdm_machine_common.json', { name: 'fdm_machine_common', gcode_flavor: 'marlin' }]],
  })
  await vendor('Elegoo', {
    filament_list: [
      [
        'filament/Generic PETG @Elegoo.json',
        { name: 'Generic PETG @Elegoo', filament_type: ['PETG'], renamed_from: 'Elegoo Old PETG' },
      ],
    ],
  })
  await vendor('OrcaFilamentLibrary', {
    filament_list: [
      ['filament/Generic PETG @System.json', { name: 'Generic PETG @System', filament_type: ['PETG'] }],
    ],
  })
  stock = await StockProfiles.load(root)
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

const printer = (extra: object = {}) =>
  JSON.stringify({ name: 'Club One', inherits: 'Acme One 0.4 nozzle', from: 'User', ...extra })

describe('flattening', () => {
  it('lays the export over its stock parents, in the parent’s own vendor', async () => {
    const resolved = await resolvePreset(printer({ printable_height: '170' }), 'PRINTER', stock)
    const profile = JSON.parse(resolved.text) as Record<string, unknown>
    expect(profile).toMatchObject({
      name: 'Club One',
      inherits: 'Acme One 0.4 nozzle',
      from: 'User',
      type: 'machine',
      gcode_flavor: 'klipper',
      printable_height: '170',
    })
    // Host addresses and stock bookkeeping don't come along.
    expect(profile['print_host']).toBeUndefined()
    expect(profile['setting_id']).toBeUndefined()
    expect(resolved.flattened.inherits.map((p) => p.source)).toEqual([
      'Acme/machine/Acme One 0.4 nozzle.json',
      'Acme/machine/fdm_machine_common.json',
    ])
    expect(resolved.info).toMatchObject({
      model: 'Acme One',
      stockName: 'Acme One 0.4 nozzle',
      bedType: 'Textured PEI Plate',
      bed: { width: 200, depth: 200, height: 170, exclude: null },
    })
  })

  it('is the same text every time, whatever order the keys came in', async () => {
    const a = await resolvePreset(JSON.stringify({ name: 'Club One', from: 'User', inherits: 'Acme One 0.4 nozzle' }), 'PRINTER', stock)
    const b = await resolvePreset(printer(), 'PRINTER', stock)
    expect(a.text).toBe(b.text)
  })

  it('finds a parent by a name it used to have, and Elegoo’s old generics as desktop Orca does', async () => {
    const byAlias = await resolvePreset(
      JSON.stringify({ name: 'Club PETG', inherits: 'Elegoo Old PETG' }),
      'FILAMENT',
      stock,
    )
    expect(JSON.parse(byAlias.text)).toMatchObject({ inherits: 'Generic PETG @Elegoo' })
    const renamed = await resolvePreset(
      JSON.stringify({ name: 'Club PETG', inherits: 'Elegoo Generic PETG' }),
      'FILAMENT',
      stock,
    )
    expect(renamed.flattened.substitutions).toEqual([
      { from: 'Elegoo Generic PETG', to: 'Generic PETG @System' },
    ])
    expect(renamed.flattened.inherits[0]?.source).toBe('OrcaFilamentLibrary/filament/Generic PETG @System.json')
  })

  it('never keeps a script to run on the G-code', async () => {
    const resolved = await resolvePreset(
      JSON.stringify({ name: 'Sneaky PLA', inherits: 'Generic PLA @Acme', post_process: ['/bin/sh -c x'] }),
      'FILAMENT',
      stock,
    )
    expect(JSON.parse(resolved.text)).not.toHaveProperty('post_process')
  })

  it.each([
    ['an unknown parent', printer({ inherits: 'Nobody 0.4 nozzle' }), /doesn't ship/],
    ['a resin printer', printer({ printer_technology: 'SLA' }), /resin/],
    ['two extruders', printer({ nozzle_diameter: ['0.4', '0.4'] }), /more than one extruder/],
    ['a round bed', printer({ printable_area: ['0x0', '100x0', '50x80'] }), /rectangle/],
    ['a bed off the origin', printer({ printable_area: ['-5x-5', '195x-5', '195x195', '-5x195'] }), /rectangle/],
  ])('refuses %s', async (_case, text, message) => {
    await expect(resolvePreset(text, 'PRINTER', stock)).rejects.toThrow(ProfileError)
    await expect(resolvePreset(text, 'PRINTER', stock)).rejects.toThrow(message)
  })

  it.each([
    ['an index', '1', 'Cool Plate'],
    ['a name', 'Textured PEI Plate', 'Textured PEI Plate'],
    ['a name in another case', 'high temp plate', 'High Temp Plate'],
    ['nothing', undefined, 'Textured PEI Plate'],
    ['an empty string', '', 'Textured PEI Plate'],
    ['the Default Plate index', '0', 'Textured PEI Plate'],
    ['the Default Plate name', 'Default Plate', 'Textured PEI Plate'],
    ['an unknown plate', 'Glass Plate', 'Textured PEI Plate'],
  ])('reads the bed type from %s, never as Default Plate', (_case, value, bedType) => {
    expect(printerInfo({ ...PRINTER, default_bed_type: value }).bedType).toBe(bedType)
  })

  it('refuses a filament made for another printer, and takes one made for it', async () => {
    const info = printerInfo({ ...PRINTER, inherits: 'Acme One 0.4 nozzle' })
    const filament = (printers: string[]) =>
      JSON.stringify({ name: 'Silk', inherits: 'Generic PLA @Acme', compatible_printers: printers })
    await expect(
      resolvePreset(filament(['Bambu Lab X1 Carbon 0.4 nozzle']), 'FILAMENT', stock, { name: 'Club One', info }),
    ).rejects.toThrow(/made for Bambu Lab X1 Carbon/)
    const fits = await resolvePreset(filament(['Acme One 0.4 nozzle']), 'FILAMENT', stock, { name: 'Club One', info })
    expect(fits.kind).toBe('FILAMENT')
  })

  it('refuses a process made for another printer', async () => {
    const info = printerInfo({ ...PRINTER, inherits: 'Acme One 0.4 nozzle' })
    const process = JSON.stringify({ name: 'Fine', compatible_printers: ['Bambu Lab X1 Carbon 0.4 nozzle'] })
    await expect(resolvePreset(process, 'PROCESS', stock, { name: 'Club One', info })).rejects.toThrow(
      /made for Bambu Lab X1 Carbon/,
    )
  })
})

describe('which printers a profile fits', () => {
  const club = { name: 'CC1', stockName: 'Elegoo Centauri Carbon 0.4 nozzle' }
  it('reads an empty list as any printer, and matches the club’s name or its stock parent', () => {
    expect(fitsPrinter([], club)).toBe(true)
    expect(fitsPrinter(['Elegoo Centauri Carbon 0.4 nozzle'], club)).toBe(true)
    expect(fitsPrinter(['CC1'], club)).toBe(true)
    expect(fitsPrinter(['Bambu Lab X1 Carbon 0.4 nozzle'], club)).toBe(false)
  })
})
