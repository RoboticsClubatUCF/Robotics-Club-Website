import { z } from 'zod'

/**
 * What a member may change about how a filament plate is sliced, on top of the preset they picked.
 *
 * One table drives the validation, the strings Orca is given and the workspace's controls. The web
 * package has a copy in `web/src/lib/slicer/processSettings.ts`; both are tested against
 * `processSettings.vectors.json`, and CI fails if the two vector files differ.
 *
 * Keys are Orca's own, so the `.3mf` an officer opens shows the same names. Speeds, temperatures,
 * cooling, flow and machine G-code are deliberately absent: those are what break a printer rather
 * than a print.
 */

export type SettingTab = 'quality' | 'strength' | 'support' | 'others'

interface Base {
  key: string
  tab: SettingTab
  label: string
}

export type SettingDef =
  | (Base & { kind: 'float'; min: number; max: number; step: number; unit: string })
  | (Base & { kind: 'int'; min: number; max: number; unit?: string })
  | (Base & { kind: 'percent'; min: number; max: number })
  | (Base & { kind: 'bool' })
  | (Base & { kind: 'choice'; choices: readonly { value: string; label: string }[] })

const SURFACE_PATTERNS = [
  { value: 'monotonic', label: 'Monotonic' },
  { value: 'monotonicline', label: 'Monotonic line' },
  { value: 'rectilinear', label: 'Rectilinear' },
  { value: 'alignedrectilinear', label: 'Aligned rectilinear' },
  { value: 'concentric', label: 'Concentric' },
  { value: 'hilbertcurve', label: 'Hilbert curve' },
  { value: 'archimedeanchords', label: 'Archimedean chords' },
  { value: 'octagramspiral', label: 'Octagram spiral' },
] as const

export const PROCESS_SETTINGS: readonly SettingDef[] = [
  // Quality
  { key: 'layer_height', tab: 'quality', label: 'Layer height', kind: 'float', min: 0.08, max: 0.28, step: 0.01, unit: 'mm' },
  { key: 'initial_layer_print_height', tab: 'quality', label: 'First layer height', kind: 'float', min: 0.1, max: 0.3, step: 0.01, unit: 'mm' },
  {
    key: 'wall_generator',
    tab: 'quality',
    label: 'Wall generator',
    kind: 'choice',
    choices: [
      { value: 'classic', label: 'Classic' },
      { value: 'arachne', label: 'Arachne' },
    ],
  },
  {
    key: 'seam_position',
    tab: 'quality',
    label: 'Seam position',
    kind: 'choice',
    choices: [
      { value: 'nearest', label: 'Nearest' },
      { value: 'aligned', label: 'Aligned' },
      { value: 'back', label: 'Back' },
      { value: 'random', label: 'Random' },
    ],
  },
  {
    key: 'ironing_type',
    tab: 'quality',
    label: 'Ironing',
    kind: 'choice',
    choices: [
      { value: 'no ironing', label: 'None' },
      { value: 'top', label: 'Top surfaces' },
      { value: 'topmost', label: 'Topmost surface' },
      { value: 'solid', label: 'All solid layers' },
    ],
  },

  // Strength
  { key: 'wall_loops', tab: 'strength', label: 'Walls', kind: 'int', min: 1, max: 10 },
  { key: 'top_shell_layers', tab: 'strength', label: 'Top layers', kind: 'int', min: 0, max: 30 },
  { key: 'top_shell_thickness', tab: 'strength', label: 'Top thickness', kind: 'float', min: 0, max: 5, step: 0.1, unit: 'mm' },
  { key: 'bottom_shell_layers', tab: 'strength', label: 'Bottom layers', kind: 'int', min: 0, max: 30 },
  { key: 'bottom_shell_thickness', tab: 'strength', label: 'Bottom thickness', kind: 'float', min: 0, max: 5, step: 0.1, unit: 'mm' },
  { key: 'sparse_infill_density', tab: 'strength', label: 'Infill density', kind: 'percent', min: 0, max: 100 },
  {
    key: 'sparse_infill_pattern',
    tab: 'strength',
    label: 'Infill pattern',
    kind: 'choice',
    // Orca 2.4.2's list less the ones still marked experimental there.
    choices: [
      { value: 'rectilinear', label: 'Rectilinear' },
      { value: 'alignedrectilinear', label: 'Aligned rectilinear' },
      { value: 'zigzag', label: 'Zig zag' },
      { value: 'line', label: 'Line' },
      { value: 'grid', label: 'Grid' },
      { value: 'triangles', label: 'Triangles' },
      { value: 'tri-hexagon', label: 'Tri-hexagon' },
      { value: 'cubic', label: 'Cubic' },
      { value: 'adaptivecubic', label: 'Adaptive cubic' },
      { value: 'quartercubic', label: 'Quarter cubic' },
      { value: 'supportcubic', label: 'Support cubic' },
      { value: 'lightning', label: 'Lightning' },
      { value: 'honeycomb', label: 'Honeycomb' },
      { value: '3dhoneycomb', label: '3D honeycomb' },
      { value: 'crosshatch', label: 'Cross hatch' },
      { value: 'gyroid', label: 'Gyroid' },
      { value: 'concentric', label: 'Concentric' },
    ],
  },
  { key: 'top_surface_pattern', tab: 'strength', label: 'Top surface pattern', kind: 'choice', choices: SURFACE_PATTERNS },
  { key: 'bottom_surface_pattern', tab: 'strength', label: 'Bottom surface pattern', kind: 'choice', choices: SURFACE_PATTERNS },

  // Support
  { key: 'enable_support', tab: 'support', label: 'Supports', kind: 'bool' },
  {
    key: 'support_type',
    tab: 'support',
    label: 'Support type',
    kind: 'choice',
    // The manual types only print where a painted enforcer says, and the workspace can't paint.
    choices: [
      { value: 'normal(auto)', label: 'Normal' },
      { value: 'tree(auto)', label: 'Tree' },
    ],
  },
  { key: 'support_threshold_angle', tab: 'support', label: 'Threshold angle', kind: 'int', min: 0, max: 90, unit: '°' },
  { key: 'support_on_build_plate_only', tab: 'support', label: 'On build plate only', kind: 'bool' },
  { key: 'raft_layers', tab: 'support', label: 'Raft layers', kind: 'int', min: 0, max: 5 },

  // Others
  {
    key: 'brim_type',
    tab: 'others',
    label: 'Brim',
    kind: 'choice',
    choices: [
      { value: 'auto_brim', label: 'Auto' },
      { value: 'outer_only', label: 'Outer only' },
      { value: 'inner_only', label: 'Inner only' },
      { value: 'outer_and_inner', label: 'Outer and inner' },
      { value: 'no_brim', label: 'None' },
    ],
  },
  { key: 'brim_width', tab: 'others', label: 'Brim width', kind: 'float', min: 0, max: 20, step: 0.5, unit: 'mm' },
  { key: 'skirt_loops', tab: 'others', label: 'Skirt loops', kind: 'int', min: 0, max: 5 },
  { key: 'spiral_mode', tab: 'others', label: 'Vase mode', kind: 'bool' },
  {
    key: 'fuzzy_skin',
    tab: 'others',
    label: 'Fuzzy skin',
    kind: 'choice',
    choices: [
      { value: 'disabled_fuzzy', label: 'Off' },
      { value: 'external', label: 'Outer walls' },
      { value: 'all', label: 'All walls' },
    ],
  },
]

export type SettingValue = number | boolean | string

/** The overrides a draft stores: only the keys its owner changed. */
export type ProcessOverrides = Partial<Record<string, SettingValue>>

const byKey = new Map(PROCESS_SETTINGS.map((def) => [def.key, def]))

export const settingDef = (key: string): SettingDef | undefined => byKey.get(key)

/** Floats are kept to the control's step, so 0.2 and 0.20000001 can't fingerprint differently. */
const roundTo = (value: number, step: number) => {
  const places = Math.max(0, Math.ceil(-Math.log10(step)))
  return Number(value.toFixed(places))
}

function valueSchema(def: SettingDef) {
  switch (def.kind) {
    case 'float':
      return z
        .number()
        .finite()
        .min(def.min)
        .max(def.max)
        .transform((value) => roundTo(value, def.step))
    case 'int':
    case 'percent':
      return z.number().int().min(def.min).max(def.max)
    case 'bool':
      return z.boolean()
    case 'choice':
      return z.enum(def.choices.map((choice) => choice.value) as [string, ...string[]])
  }
}

export const processOverrides = z
  .object(
    Object.fromEntries(
      PROCESS_SETTINGS.map((def) => [def.key, valueSchema(def).optional()]),
    ),
  )
  .strict()
  .transform((overrides) => {
    // Absent and undefined are the same thing; keep only what was set so equal edits store
    // equal JSON.
    const kept: ProcessOverrides = {}
    for (const def of PROCESS_SETTINGS) {
      const value = overrides[def.key]
      if (value !== undefined) kept[def.key] = value as SettingValue
    }
    return kept
  })

/** A value as Orca's config files spell it. */
export function toOrca(def: SettingDef, value: SettingValue): string {
  switch (def.kind) {
    case 'percent':
      return `${String(value)}%`
    case 'bool':
      return value ? '1' : '0'
    default:
      return String(value)
  }
}

/** The reverse, for reading a preset's own value out of its profile. */
export function fromOrca(def: SettingDef, raw: string): SettingValue {
  switch (def.kind) {
    case 'float':
      return roundTo(Number.parseFloat(raw), def.step)
    case 'int':
      return Number.parseInt(raw, 10)
    case 'percent':
      return Number.parseInt(raw.replace('%', ''), 10)
    case 'bool':
      return raw === '1' || raw === 'true'
    case 'choice':
      return raw
  }
}

/** Overrides as the process keys the worker merges over the preset. */
export function orcaOverrides(overrides: ProcessOverrides): Record<string, string> {
  const out: Record<string, string> = {}
  for (const def of PROCESS_SETTINGS) {
    const value = overrides[def.key]
    if (value !== undefined) out[def.key] = toOrca(def, value)
  }
  return out
}

/** The club's process presets, by the name the database stores. */
export const PRESET_FILES = {
  STANDARD: 'process-standard.json',
  Q: 'process-q.json',
  QS: 'process-qs.json',
} as const

export const MATERIAL_FILES = {
  PLA: 'filament-pla.json',
  PETG: 'filament-petg.json',
} as const
