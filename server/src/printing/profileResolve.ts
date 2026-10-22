import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { PROCESS_SETTINGS, fromOrca, settingDef } from './processSettings.js'

/**
 * Turning what desktop Orca exports into a profile the worker can slice with.
 *
 * An exported preset is a sparse diff against a stock one it names in `inherits`, and the CLI
 * can't be trusted to find that parent the way the desktop app does. So the worker flattens it
 * against Orca's own stock profiles, parent first with each child replacing whole keys (how Orca
 * applies a preset), and stores it complete. Only the worker image has the stock profiles; the API
 * just reads uploads (`readPresetFile`) and leaves the rest to the worker.
 *
 * Every refusal here is a `ProfileError`, written for the officer who uploaded the file.
 */

export type ProfileKind = 'PRINTER' | 'PROCESS' | 'FILAMENT'

type Profile = Record<string, unknown>

type OrcaType = 'machine' | 'process' | 'filament'

const ORCA_TYPE: Record<ProfileKind, OrcaType> = {
  PRINTER: 'machine',
  PROCESS: 'process',
  FILAMENT: 'filament',
}

export class ProfileError extends Error {}

export const sha256 = (text: string): string =>
  createHash('sha256').update(text).digest('hex')

// ------------------------------------------------------------------ uploads

/** One preset found in an uploaded file. `text` is the entry as exported, untouched. */
export interface UploadedPreset {
  entry: string
  kind: ProfileKind
  name: string
  inherits: string
  text: string
}

/** Bundles are a few kilobytes. These stop a zip bomb, not a real export. */
const MAX_ENTRY_BYTES = 1024 * 1024
const MAX_ENTRIES = 200

const isZip = (bytes: Uint8Array) => bytes[0] === 0x50 && bytes[1] === 0x4b

function kindFromContent(profile: Profile): ProfileKind | null {
  switch (profile['type']) {
    case 'machine':
      return 'PRINTER'
    case 'process':
      return 'PROCESS'
    case 'filament':
      return 'FILAMENT'
  }
  if ('printer_settings_id' in profile || 'printable_area' in profile) return 'PRINTER'
  if ('filament_settings_id' in profile || 'filament_type' in profile) return 'FILAMENT'
  if ('print_settings_id' in profile) return 'PROCESS'
  return null
}

function kindFromPath(entry: string): ProfileKind | null {
  const folder = entry.split('/')[0]?.toLowerCase()
  if (folder === 'printer' || folder === 'machine') return 'PRINTER'
  if (folder === 'process') return 'PROCESS'
  if (folder === 'filament') return 'FILAMENT'
  return null
}

/** What `bundle_structure.json` says each entry is, when the bundle has one. */
function kindsFromBundle(text: string | undefined): Map<string, ProfileKind> {
  const kinds = new Map<string, ProfileKind>()
  if (!text) return kinds
  let structure: Profile
  try {
    structure = JSON.parse(text) as Profile
  } catch {
    return kinds
  }
  const list = (value: unknown) =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  for (const entry of list(structure['printer_config'])) kinds.set(entry, 'PRINTER')
  for (const entry of list(structure['process_config'])) kinds.set(entry, 'PROCESS')
  for (const entry of list(structure['filament_config'])) kinds.set(entry, 'FILAMENT')
  // A filament bundle groups its presets by vendor instead.
  const vendors = Array.isArray(structure['printer_vendor']) ? structure['printer_vendor'] : []
  for (const vendor of vendors as Profile[]) {
    for (const entry of list(vendor['filament_path'])) kinds.set(entry, 'FILAMENT')
  }
  return kinds
}

function parsePreset(entry: string, text: string, kind: ProfileKind | null): UploadedPreset {
  let profile: unknown
  try {
    profile = JSON.parse(text)
  } catch {
    throw new ProfileError(`${entry} isn't readable JSON.`)
  }
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new ProfileError(`${entry} isn't an Orca preset.`)
  }
  const preset = profile as Profile
  const name = preset['name']
  if (typeof name !== 'string' || name.trim() === '') {
    throw new ProfileError(`${entry} has no preset name.`)
  }
  const found = kind ?? kindFromContent(preset)
  if (!found) {
    throw new ProfileError(`Couldn't tell whether ${entry} is a printer, process or filament.`)
  }
  const inherits = preset['inherits']
  return {
    entry,
    kind: found,
    name: name.trim(),
    inherits: typeof inherits === 'string' ? inherits : '',
    text,
  }
}

/**
 * Every preset in an uploaded file: an `.orca_printer` or `.orca_filament` bundle, a zip of
 * presets, or one preset's `.json`.
 */
export function readPresetFile(fileName: string, bytes: Uint8Array): UploadedPreset[] {
  if (!isZip(bytes)) {
    const text = strFromU8(bytes)
    const entry = fileName.split(/[\\/]/).pop() || 'preset.json'
    return [parsePreset(entry, text.replace(/^﻿/, ''), null)]
  }

  let files: Record<string, Uint8Array>
  let entries = 0
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        if (!file.name.toLowerCase().endsWith('.json')) return false
        entries++
        if (entries > MAX_ENTRIES || file.originalSize > MAX_ENTRY_BYTES) {
          throw new ProfileError(`That file holds more than an Orca export would.`)
        }
        return true
      },
    })
  } catch (error) {
    if (error instanceof ProfileError) throw error
    throw new ProfileError(`That file isn't a zip Orca wrote.`)
  }

  const structure = files['bundle_structure.json']
  const kinds = kindsFromBundle(structure ? strFromU8(structure) : undefined)
  const presets = Object.entries(files)
    .filter(([entry]) => entry !== 'bundle_structure.json')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([entry, data]) =>
      parsePreset(entry, strFromU8(data).replace(/^﻿/, ''), kinds.get(entry) ?? kindFromPath(entry)),
    )
  if (presets.length === 0) throw new ProfileError(`That file has no presets in it.`)
  return presets
}

// ------------------------------------------------------------ stock profiles

interface StockEntry {
  vendor: string
  path: string
}

/**
 * Parents Orca 2.4 no longer ships: Elegoo's old generics (`Elegoo Generic PLA`), which the club's
 * PLA and several of its tuned filaments were exported against. Desktop Orca finds no parent and
 * falls back to the library's generic of the same type, so the worker does too, or a filament
 * would slice with other temperatures and fans than the officer tuned it with.
 */
const renamedParent = (name: string): string | null => {
  const generic = /^Elegoo Generic (.+)$/.exec(name)
  return generic ? `Generic ${generic[1]!} @System` : null
}

/** The shared filament library other vendors' filaments inherit from. */
const LIBRARY = 'OrcaFilamentLibrary'

const INDEX_LISTS: Record<OrcaType, string> = {
  machine: 'machine_list',
  process: 'process_list',
  filament: 'filament_list',
}

/**
 * Orca's own profiles (`resources/profiles`), found by name through each vendor's index file.
 *
 * A name can repeat across vendors (every vendor has its own `fdm_machine_common`), so a parent is
 * looked for in its child's vendor first, then the shared filament library, then anywhere, the
 * way Orca resolves a vendor's presets within that vendor.
 */
export class StockProfiles {
  private readonly cache = new Map<string, Profile>()
  private aliases: Map<string, StockEntry[]> | null = null

  private constructor(
    readonly root: string,
    private readonly byName: Map<string, StockEntry[]>,
  ) {}

  static async load(root: string): Promise<StockProfiles> {
    const byName = new Map<string, StockEntry[]>()
    for (const file of (await readdir(root)).sort()) {
      if (!file.endsWith('.json') || file === 'blacklist.json') continue
      const vendor = file.slice(0, -'.json'.length)
      let index: Profile
      try {
        index = JSON.parse(await readFile(join(root, file), 'utf8')) as Profile
      } catch {
        continue
      }
      for (const [type, list] of Object.entries(INDEX_LISTS)) {
        const entries = Array.isArray(index[list]) ? (index[list] as Profile[]) : []
        for (const entry of entries) {
          const name = entry['name']
          const path = entry['sub_path']
          if (typeof name !== 'string' || typeof path !== 'string') continue
          const key = `${type}:${name}`
          const found = byName.get(key) ?? []
          found.push({ vendor, path: `${vendor}/${path}` })
          byName.set(key, found)
        }
      }
    }
    if (byName.size === 0) throw new Error(`no Orca profiles under ${root}`)
    return new StockProfiles(root, byName)
  }

  private async read(entry: StockEntry, keep = true): Promise<Profile> {
    const cached = this.cache.get(entry.path)
    if (cached) return cached
    const profile = JSON.parse(await readFile(join(this.root, entry.path), 'utf8')) as Profile
    if (keep) this.cache.set(entry.path, profile)
    return profile
  }

  /**
   * Old names, read out of every stock preset's `renamed_from`. Built once, on the first miss:
   * it reads all twelve thousand files, which takes seconds, so they aren't kept.
   */
  private async renamed(): Promise<Map<string, StockEntry[]>> {
    if (this.aliases) return this.aliases
    const aliases = new Map<string, StockEntry[]>()
    for (const [key, entries] of this.byName) {
      const type = key.slice(0, key.indexOf(':'))
      for (const entry of entries) {
        const profile = await this.read(entry, false).catch(() => null)
        const from = profile?.['renamed_from']
        if (typeof from !== 'string') continue
        for (const old of from.split(';').map((name) => name.trim()).filter(Boolean)) {
          const alias = `${type}:${old}`
          aliases.set(alias, [...(aliases.get(alias) ?? []), entry])
        }
      }
    }
    this.aliases = aliases
    return aliases
  }

  async find(type: OrcaType, name: string, vendor?: string) {
    const key = `${type}:${name}`
    const entries = this.byName.get(key) ?? (await this.renamed()).get(key) ?? []
    if (entries.length === 0) return null
    const entry =
      entries.find((e) => e.vendor === vendor) ??
      entries.find((e) => e.vendor === LIBRARY) ??
      entries[0]!
    return { profile: await this.read(entry), entry }
  }
}

// ------------------------------------------------------------------ flattening

/** Printer-host settings: the worker never talks to a printer, and these can hold addresses. */
const HOST_KEYS = [
  'print_host',
  'print_host_webui',
  'printhost_apikey',
  'printhost_authorization_type',
  'printhost_cafile',
  'printhost_password',
  'printhost_port',
  'printhost_ssl_ignore_revoke',
  'printhost_user',
  'host_type',
  'bbl_use_printhost',
  'flashforge_serial_number',
  'printer_agent',
]

const META_KEYS = [
  'setting_id',
  'instantiation',
  'renamed_from',
  'is_custom_defined',
  'base_id',
  'user_id',
  'updated_time',
]

/** `default_bed_type` on a printer is an index into this, Orca's own order, or one of the names. */
const BED_TYPES = [
  'Default Plate',
  'Cool Plate',
  'Engineering Plate',
  'High Temp Plate',
  'Textured PEI Plate',
  'Textured Cool Plate',
  'Supertack Plate',
]

/**
 * The plate a process slices on. "Default Plate" means "the printer's own" and the CLI segfaults
 * on it, so a printer that names none (most third-party ones) gets Textured PEI. Leaving the key
 * out isn't an option either: Orca then assumes a Cool Plate and its bed temperatures.
 */
function bedTypeOf(value: unknown): string {
  const raw = first(value ?? '').trim()
  const bed = /^\d+$/.test(raw)
    ? BED_TYPES[Number(raw)]
    : BED_TYPES.find((name) => name.toLowerCase() === raw.toLowerCase())
  return bed && bed !== BED_TYPES[0] ? bed : 'Textured PEI Plate'
}

export interface Parent {
  name: string
  source: string
}

export interface Flattened {
  profile: Profile
  /** The stock presets it was flattened against, nearest first. */
  inherits: Parent[]
  substitutions: { from: string; to: string }[]
}

export async function flatten(
  child: Profile,
  kind: ProfileKind,
  stock: StockProfiles,
): Promise<Flattened> {
  const type = ORCA_TYPE[kind]
  const chain: Profile[] = [child]
  const inherits: Parent[] = []
  const substitutions: { from: string; to: string }[] = []

  let current = child
  let vendor: string | undefined
  while (typeof current['inherits'] === 'string' && current['inherits'] !== '') {
    const asked = current['inherits']
    let parent = await stock.find(type, asked, vendor)
    const renamed = parent ? null : renamedParent(asked)
    if (renamed) {
      parent = await stock.find(type, renamed, vendor)
      if (parent) substitutions.push({ from: asked, to: renamed })
    }
    if (!parent) {
      throw new ProfileError(
        `It inherits from "${asked}", which OrcaSlicer doesn't ship. Export it again from a preset based on a stock one.`,
      )
    }
    if (chain.includes(parent.profile)) {
      throw new ProfileError(`Its stock parents inherit from each other in a loop.`)
    }
    vendor = parent.entry.vendor
    // Found by an old name or another casing, it's still written under its current one.
    inherits.push({ name: String(parent.profile['name']), source: parent.entry.path })
    chain.push(parent.profile)
    current = parent.profile
  }

  const merged: Profile = {}
  for (const profile of chain.toReversed()) Object.assign(merged, profile)

  for (const key of [...HOST_KEYS, ...META_KEYS]) delete merged[key]

  // The CLI reads `inherits` as the stock name it checks compatibility against, and desktop Orca
  // links an opened project to it, so it stays as the first stock parent.
  merged['inherits'] = inherits[0]?.name ?? ''
  merged['from'] = 'User'
  merged['name'] = child['name']
  merged['type'] = type

  return { profile: merged, inherits, substitutions }
}

/** Keys sorted and tab-indented, so the same profile always hashes the same. */
export function serialise(profile: Profile): string {
  const sorted = Object.fromEntries(
    Object.keys(profile)
      .sort()
      .map((key) => [key, profile[key]]),
  )
  return `${JSON.stringify(sorted, null, '\t')}\n`
}

const first = (value: unknown): string => String(Array.isArray(value) ? value[0] : value)

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string' && v !== '')
    : typeof value === 'string' && value !== ''
      ? value.split(';').map((v) => v.trim())
      : []

function points(value: unknown): [number, number][] {
  return strings(value).map((point) => {
    const [x, y] = point.split('x').map(Number)
    return [x ?? Number.NaN, y ?? Number.NaN]
  })
}

// ------------------------------------------------------------------ what each kind tells us

export interface PrinterInfo {
  model: string
  /** The stock printer it was made from, which processes and filaments name as compatible. */
  stockName: string
  nozzle: number
  bedType: string
  bed: {
    width: number
    depth: number
    height: number
    exclude: { minX: number; minY: number; maxX: number; maxY: number } | null
  }
  layerHeight: { min: number; max: number }
}

export interface ProcessInfo {
  values: Record<string, number | boolean | string>
  summary: string
  compatiblePrinters: string[]
}

export interface FilamentInfo {
  type: string
  vendor: string
  compatiblePrinters: string[]
}

export function printerInfo(profile: Profile): PrinterInfo {
  const technology = profile['printer_technology']
  if (technology !== undefined && technology !== 'FFF') {
    throw new ProfileError(`It's a resin printer. The slicer is for filament printers.`)
  }
  if (strings(profile['nozzle_diameter']).length > 1) {
    throw new ProfileError(`It has more than one extruder. The slicer handles one.`)
  }
  const bedType = bedTypeOf(profile['default_bed_type'])

  const area = points(profile['printable_area'])
  const xs = area.map(([x]) => x)
  const ys = area.map(([, y]) => y)
  const width = Math.max(...xs)
  const depth = Math.max(...ys)
  const rectangle =
    area.length === 4 &&
    Math.min(...xs) === 0 &&
    Math.min(...ys) === 0 &&
    area.every(([x, y]) => (x === 0 || x === width) && (y === 0 || y === depth))
  if (!rectangle || !(width > 0) || !(depth > 0)) {
    throw new ProfileError(
      `Its bed isn't a rectangle with a corner at 0,0, which is the only shape the slicer places parts on.`,
    )
  }
  const height = Number(first(profile['printable_height']))
  const nozzle = Number(first(profile['nozzle_diameter']))
  const min = Number(first(profile['min_layer_height']))
  const max = Number(first(profile['max_layer_height']))
  if (![height, nozzle, min, max].every((n) => Number.isFinite(n) && n > 0)) {
    throw new ProfileError(`It's missing its height, nozzle or layer limits.`)
  }

  const exclude = points(profile['bed_exclude_area'])
  return {
    model: first(profile['printer_model'] ?? ''),
    stockName: String(profile['inherits'] ?? ''),
    nozzle,
    bedType,
    bed: {
      width,
      depth,
      height,
      exclude:
        exclude.length > 0
          ? {
              minX: Math.min(...exclude.map(([x]) => x)),
              minY: Math.min(...exclude.map(([, y]) => y)),
              maxX: Math.max(...exclude.map(([x]) => x)),
              maxY: Math.max(...exclude.map(([, y]) => y)),
            }
          : null,
    },
    layerHeight: { min, max },
  }
}

/** Orca's built-in defaults (`PrintConfig.cpp`, 2.4.2) for keys no stock preset sets. */
const ORCA_DEFAULTS: Record<string, string> = {
  fuzzy_skin: 'disabled_fuzzy',
}

function presetValues(profile: Profile) {
  const values: Record<string, number | boolean | string> = {}
  for (const def of PROCESS_SETTINGS) {
    const raw = profile[def.key] ?? ORCA_DEFAULTS[def.key]
    if (raw === undefined) throw new ProfileError(`It has no ${def.key}.`)
    try {
      values[def.key] = fromOrca(def, first(raw))
    } catch {
      throw new ProfileError(`Its ${def.key} of ${JSON.stringify(first(raw))} isn't one the slicer reads.`)
    }
  }
  return values
}

/** "2 walls, 15% line", for a process nobody has described. */
export function processSummary(values: Record<string, unknown>): string {
  const pattern = settingDef('sparse_infill_pattern')
  const label =
    pattern?.kind === 'choice'
      ? (pattern.choices.find((choice) => choice.value === values['sparse_infill_pattern'])
          ?.label ?? String(values['sparse_infill_pattern']))
      : ''
  return `${String(values['wall_loops'])} walls, ${String(values['sparse_infill_density'])}% ${label.toLowerCase()}`
}

/** Whether a process or filament says it fits this printer. An empty list fits any. */
export function fitsPrinter(
  compatiblePrinters: readonly string[],
  printer: { name: string; stockName: string },
): boolean {
  return (
    compatiblePrinters.length === 0 ||
    compatiblePrinters.includes(printer.name) ||
    (printer.stockName !== '' && compatiblePrinters.includes(printer.stockName))
  )
}

// ------------------------------------------------------------------ the whole job

export type Resolved =
  | { kind: 'PRINTER'; text: string; info: PrinterInfo; flattened: Flattened }
  | { kind: 'PROCESS'; text: string; info: ProcessInfo; flattened: Flattened }
  | { kind: 'FILAMENT'; text: string; info: FilamentInfo; flattened: Flattened }

/**
 * One uploaded preset, flattened and checked. A process needs its printer, already resolved: the
 * CLI takes the plate from the process, and without the printer's it falls back to Cool Plate
 * and then refuses PETG.
 */
export async function resolvePreset(
  source: string,
  kind: ProfileKind,
  stock: StockProfiles,
  printer?: { name: string; info: PrinterInfo },
): Promise<Resolved> {
  let child: Profile
  try {
    child = JSON.parse(source) as Profile
  } catch {
    throw new ProfileError(`It isn't readable JSON.`)
  }
  const flattened = await flatten(child, kind, stock)
  const profile = flattened.profile
  // A process can name scripts for Orca to run on the G-code, and the CLI applies whatever keys a
  // file holds, whichever kind it is. Nothing runs inside the worker but Orca.
  if (kind !== 'PROCESS') delete profile['post_process']

  if (kind === 'PRINTER') {
    const info = printerInfo(profile)
    return { kind, text: serialise(profile), info, flattened }
  }

  if (kind === 'PROCESS') {
    if (!printer) throw new Error('a process is resolved with its printer')
    const compatiblePrinters = strings(profile['compatible_printers'])
    if (!fitsPrinter(compatiblePrinters, { name: printer.name, stockName: printer.info.stockName })) {
      throw new ProfileError(
        `It's made for ${compatiblePrinters.join(', ')}, not ${printer.name}.`,
      )
    }
    profile['curr_bed_type'] = printer.info.bedType
    profile['post_process'] = []
    const values = presetValues(profile)
    return {
      kind,
      text: serialise(profile),
      info: { values, summary: processSummary(values), compatiblePrinters },
      flattened,
    }
  }

  const type = first(profile['filament_type'] ?? '')
  if (type === '' || type === 'undefined') throw new ProfileError(`It has no filament type.`)
  return {
    kind,
    text: serialise(profile),
    info: {
      type,
      vendor: first(profile['filament_vendor'] ?? ''),
      compatiblePrinters: strings(profile['compatible_printers']),
    },
    flattened,
  }
}
