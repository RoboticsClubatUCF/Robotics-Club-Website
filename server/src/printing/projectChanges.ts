import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { type ProfileKind, ProfileError, type StockProfiles, flatten } from './profileResolve.js'

/**
 * Telling desktop Orca which settings in a sliced project are the club's and the member's.
 *
 * Orca 2.4.2 opens a project by taking each preset's stock parent (`inherits_group`) and keeping
 * the project's own value only for the keys `different_settings_to_system` names; every other
 * key goes back to stock. The CLI writes that list empty, so an officer opening the `.3mf` got
 * stock walls, infill and printer G-code. Desktop Orca writes the keys that differ from the stock
 * parent, and so does this.
 *
 * Values are compared with Orca's own export of the stock presets where there is one: naming a
 * key the project doesn't change makes desktop Orca keep the project's copy, which can differ
 * from its own in ways the settings window can't show (a one-value list against two) and then
 * reads as changed there. Without that export, a key is named whenever in doubt.
 */

type Profile = Record<string, unknown>

const SETTINGS = 'Metadata/project_settings.config'

/** Keys that name or file a preset rather than set anything. */
const NOT_SETTINGS = new Set([
  'name',
  'from',
  'type',
  'inherits',
  'version',
  'setting_id',
  'instantiation',
  'renamed_from',
  'filament_id',
  'print_settings_id',
  'printer_settings_id',
  'filament_settings_id',
  'compatible_printers',
  'compatible_printers_condition',
  'compatible_prints',
  'compatible_prints_condition',
  'different_settings_to_system',
  'inherits_group',
])

const values = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value]).map((v) => String(v))

// Orca rewrites numbers its own way ("0.20" comes back "0.2").
const sameValue = (a: string, b: string) => {
  if (a === b) return true
  if (a.trim() === '' || b.trim() === '') return false
  const pct = (s: string) => s.endsWith('%')
  const x = Number(a.replace(/%$/, ''))
  const y = Number(b.replace(/%$/, ''))
  return pct(a) === pct(b) && Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) < 1e-9
}

const same = (a: unknown, b: unknown) => {
  const x = values(a)
  const y = values(b)
  return x.length === y.length && x.every((v, i) => sameValue(v, y[i]!))
}

/** The stock preset a club profile was made from, flattened. Null when it has none. */
export async function stockParent(
  stock: StockProfiles,
  kind: ProfileKind,
  name: string,
): Promise<Profile | null> {
  if (name === '') return null
  try {
    return (await flatten({ inherits: name }, kind, stock)).profile
  } catch (error) {
    if (error instanceof ProfileError) return null
    throw error
  }
}

/**
 * The keys of one preset whose value in the project differs from the stock one. `own` is the
 * club's flattened profile and `parent` its stock parent, which between them hold every key of
 * their kind; `extra` are keys the member set. `stock` is what the values are compared with:
 * Orca's export of the stock presets, or else `parent`.
 */
export function changedKeys(
  project: Profile,
  own: Profile,
  parent: Profile | null,
  extra: string[] = [],
  stock: Profile | null = parent,
): string[] {
  const keys = new Set([...Object.keys(own), ...Object.keys(parent ?? {}), ...extra])
  return [...keys]
    .filter((key) => !NOT_SETTINGS.has(key) && key in project)
    .filter((key) => !stock || !(key in stock) || !same(project[key], stock[key]))
    .sort()
}

export interface PresetChanges {
  process: { own: Profile; parent: Profile | null; extra: string[] }
  filament: { own: Profile; parent: Profile | null }
  printer: { own: Profile; parent: Profile | null }
  /** Orca's own project for the stock presets, when it would write one. */
  stock: Profile | null
}

/**
 * The sliced `.3mf` with `different_settings_to_system` filled in: process, then the one
 * filament, then printer, each a `;`-joined list, the way desktop Orca saves it.
 */
export function markChangedSettings(
  bytes: Uint8Array<ArrayBuffer>,
  changes: PresetChanges,
): Uint8Array<ArrayBuffer> {
  const files = unzipSync(bytes)
  const text = files[SETTINGS]
  if (!text) return bytes
  const raw = strFromU8(text)
  const project = JSON.parse(raw) as Profile

  const { process, filament, printer, stock } = changes
  const lists = [
    changedKeys(project, process.own, process.parent, process.extra, stock ?? process.parent),
    changedKeys(project, filament.own, filament.parent, [], stock ?? filament.parent),
    changedKeys(project, printer.own, printer.parent, [], stock ?? printer.parent),
  ].map((keys) => keys.join(';'))

  // Only this key is rewritten; the rest stays exactly as Orca wrote it.
  const entry = JSON.stringify(lists, null, '\t').replace(/\n/g, '\n\t')
  const pattern = /("different_settings_to_system":\s*)\[[^\]]*\]/
  const updated = pattern.test(raw)
    ? raw.replace(pattern, (_, key: string) => `${key}${entry}`)
    : `${JSON.stringify({ ...project, different_settings_to_system: lists }, null, '\t')}\n`

  files[SETTINGS] = strToU8(updated)
  return new Uint8Array(zipSync(files, { level: 6 }))
}
