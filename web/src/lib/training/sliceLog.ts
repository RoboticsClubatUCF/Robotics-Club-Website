import { PROCESS_SETTINGS, type SettingDef, type SettingValue, settingDef } from '../slicer/processSettings'
import { PRACTICE_WORKSPACE } from './practiceProfiles'
import { type SlicedWith, comparable, differences, same } from './practiceSlices'

/**
 * The slices made in a practice task, so each can be set beside the one before: what changed
 * between them, the way the settings column words it, and Orca's numbers for each.
 */

export interface SliceRecord extends SlicedWith {
  /** One record per press of SLICE PLATE. */
  requestedAt: string
  part: string
  grams: number
  seconds: number
  layers: number | null
  /** The member's changes this ready-made slice doesn't have, as `matchSlice` names them. */
  missing: string[]
}

export interface SliceLog {
  /** The plate's settings when the task began, which the first slice is set beside. */
  start: SlicedWith | null
  slices: SliceRecord[]
}

const PRINTER = PRACTICE_WORKSPACE.profiles.printers[0]!

function shown(def: SettingDef, value: SettingValue): string {
  switch (def.kind) {
    case 'bool':
      return value === true ? 'On' : 'Off'
    case 'choice':
      return def.choices.find((choice) => choice.value === value)?.label ?? String(value)
    case 'percent':
      return `${String(value)}%`
    case 'float':
    case 'int':
      return def.unit === undefined ? String(value) : def.unit === '°' ? `${String(value)}°` : `${String(value)} ${def.unit}`
  }
}

/**
 * What's different about `after`, in settings-column order. A setting that can't change the slice
 * (the support type with supports off) isn't listed, and nor is one that came with a new process.
 */
export function changes(before: SlicedWith, after: SlicedWith, part?: string): string[] {
  const out: string[] = []
  const newProcess = before.processId !== after.processId
  if (newProcess) out.push(`Process: ${PRINTER.processes.find((p) => p.id === after.processId)?.label ?? after.processId}`)
  if (before.filamentId !== after.filamentId) {
    out.push(`Filament: ${PRACTICE_WORKSPACE.profiles.filaments.find((f) => f.id === after.filamentId)?.label ?? after.filamentId}`)
  }
  const own = PRINTER.processes.find((p) => p.id === after.processId)?.values ?? {}
  const differ = new Set(differences(comparable(before.values, part), comparable(after.values, part)))
  for (const def of PROCESS_SETTINGS) {
    const value = after.values[def.key]
    if (!differ.has(def.key) || value === undefined || same(before.values[def.key], value)) continue
    if (newProcess && same(own[def.key], value)) continue
    out.push(`${def.label}: ${shown(def, value)}`)
  }
  if (before.upsideDown !== after.upsideDown) out.push(after.upsideDown ? 'Upside down' : 'Standing up')
  return out
}

/**
 * A slice's label in the log: what changed since the slice before it, or since the task began, and
 * any change of the member's a stand-in slice doesn't show.
 */
export function labelOf(log: SliceLog, index: number): string {
  const slice = log.slices[index]!
  const before = index === 0 ? log.start : log.slices[index - 1]!
  const changed = before ? changes(before, slice, slice.part) : []
  const text = changed.length > 0 ? changed.join(', ') : index === 0 ? 'As it is' : 'No change'
  const missing = slice.missing.map((key) =>
    key === 'process' ? 'Process' : key === 'filament' ? 'Filament' : (settingDef(key)?.label ?? key),
  )
  return missing.length > 0 ? `${text}; not shown: ${missing.join(', ')}` : text
}
