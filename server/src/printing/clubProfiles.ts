import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type FilamentInfo,
  type PrinterInfo,
  type ProcessInfo,
  type StockProfiles,
  readPresetFile,
  resolvePreset,
} from './profileResolve.js'
import type { LoadedProfile } from './profiles.js'

/**
 * The club's own Orca exports in `orca/source/`, resolved the way the worker resolves an officer's
 * upload. Only the scripts that run in the worker image use this (`sliceSmoke.ts`,
 * `trainingSlices.ts`); the worker itself reads profiles from the database.
 */

const sources = fileURLToPath(new URL('../../orca/source/', import.meta.url))

export const PROCESSES = {
  STANDARD: 'process/0.20mm, 0.4 nozzle, Line, T-Support.json',
  Q: 'process/0.20mm, Q, 0.4 nozzle, Line, T-Support.json',
  QS: 'process/0.20mm, Q-S, 0.4 nozzle, Line, T-Support.json',
} as const

export const FILAMENTS = {
  PLA: ['Generic PLA.orca_filament', 'System/Elegoo Rapid PLA.json'],
  PETG: ['Elegoo Rapid PETG.orca_filament', 'ECC/Elegoo RAPID PETG Optimized.json'],
} as const

export const CLUB_BUNDLES = [
  'CC1.orca_printer',
  'Generic PLA.orca_filament',
  'Elegoo Rapid PETG.orca_filament',
] as const

export async function presetsIn(bundle: string) {
  return readPresetFile(bundle, new Uint8Array(await readFile(join(sources, bundle))))
}

async function entry(bundle: string, name: string) {
  const preset = (await presetsIn(bundle)).find((p) => p.entry === name)
  if (!preset) throw new Error(`${bundle} has no ${name}`)
  return preset
}

function asLoaded<Info>(name: string, resolved: { text: string; info: Info }): LoadedProfile<Info> {
  return { id: name, name, text: resolved.text, info: resolved.info }
}

export async function clubProfiles(stock: StockProfiles) {
  const cc1 = await entry('CC1.orca_printer', 'printer/CC1.json')
  const printer = await resolvePreset(cc1.text, 'PRINTER', stock)
  if (printer.kind !== 'PRINTER') throw new Error('CC1 is not a printer')
  const machine = asLoaded<PrinterInfo>(cc1.name, printer)

  const processes = {} as Record<keyof typeof PROCESSES, LoadedProfile<ProcessInfo>>
  for (const [key, path] of Object.entries(PROCESSES)) {
    const preset = await entry('CC1.orca_printer', path)
    const resolved = await resolvePreset(preset.text, 'PROCESS', stock, { name: cc1.name, info: printer.info })
    if (resolved.kind !== 'PROCESS') throw new Error(`${path} is not a process`)
    processes[key as keyof typeof PROCESSES] = asLoaded(preset.name, resolved)
  }

  const filaments = {} as Record<keyof typeof FILAMENTS, LoadedProfile<FilamentInfo>>
  for (const [key, [bundle, path]] of Object.entries(FILAMENTS)) {
    const preset = await entry(bundle, path)
    const resolved = await resolvePreset(preset.text, 'FILAMENT', stock)
    if (resolved.kind !== 'FILAMENT') throw new Error(`${path} is not a filament`)
    filaments[key as keyof typeof FILAMENTS] = asLoaded(preset.name, resolved)
  }
  return { printer: machine, processes, filaments }
}
