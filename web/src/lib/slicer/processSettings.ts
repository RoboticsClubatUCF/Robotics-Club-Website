/**
 * What a member may change about how a filament plate is sliced, on top of the preset they picked.
 *
 * A copy of `server/src/printing/processSettings.ts`, which validates the same edits and writes
 * them into Orca's process profile. Both are tested against `processSettings.vectors.json`, and CI
 * fails if the two vector files differ, so change the two tables together. The server's copy uses
 * zod; this one checks by hand, since the web package doesn't carry zod.
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
export const roundTo = (value: number, step: number) => {
  const places = Math.max(0, Math.ceil(-Math.log10(step)))
  return Number(value.toFixed(places))
}

/** One value, checked and normalised the way the server will; undefined if it would refuse it. */
export function checkValue(def: SettingDef, value: unknown): SettingValue | undefined {
  switch (def.kind) {
    case 'float':
      return typeof value === 'number' && Number.isFinite(value) && value >= def.min && value <= def.max
        ? roundTo(value, def.step)
        : undefined
    case 'int':
    case 'percent':
      return typeof value === 'number' && Number.isInteger(value) && value >= def.min && value <= def.max
        ? value
        : undefined
    case 'bool':
      return typeof value === 'boolean' ? value : undefined
    case 'choice':
      return def.choices.some((choice) => choice.value === value) ? (value as string) : undefined
  }
}

/** The whole set, refused if any key is unknown or any value out of bounds. */
export function parseOverrides(input: unknown): ProcessOverrides | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const out: ProcessOverrides = {}
  for (const [key, value] of Object.entries(input)) {
    const def = byKey.get(key)
    if (!def) return null
    if (value === undefined) continue
    const checked = checkValue(def, value)
    if (checked === undefined) return null
    out[key] = checked
  }
  // In table order, so equal edits make equal JSON.
  const ordered: ProcessOverrides = {}
  for (const def of PROCESS_SETTINGS) {
    if (out[def.key] !== undefined) ordered[def.key] = out[def.key]
  }
  return ordered
}

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


/** How a value reads on screen: "4", "25%", "0.16 mm", "On", "Gyroid". */
export function displayValue(def: SettingDef, value: SettingValue): string {
  switch (def.kind) {
    case 'float':
      return `${String(value)} ${def.unit}`
    case 'int':
      return def.unit ? `${String(value)}${def.unit}` : String(value)
    case 'percent':
      return `${String(value)}%`
    case 'bool':
      return value ? 'On' : 'Off'
    case 'choice':
      return def.choices.find((choice) => choice.value === value)?.label ?? String(value)
  }
}

/** The changed settings in one line, for the queue and the request history. */
export function overridesLine(overrides: ProcessOverrides | null): string {
  if (!overrides) return ''
  return PROCESS_SETTINGS.filter((def) => overrides[def.key] !== undefined)
    .map((def) => `${def.label} ${displayValue(def, overrides[def.key]!)}`)
    .join(' · ')
}

export const TABS: { key: SettingTab; label: string }[] = [
  { key: 'quality', label: 'Quality' },
  { key: 'strength', label: 'Strength' },
  { key: 'support', label: 'Support' },
  { key: 'others', label: 'Others' },
]

/** What Orca 2.4.2 sets these to in vase mode, whatever the process or the member says. */
const VASE_FORCES: [key: string, value: SettingValue][] = [
  ['wall_loops', 1],
  ['sparse_infill_density', 0],
  ['top_shell_layers', 0],
]

/**
 * Why Orca won't slice this in vase mode, or null: the server's `vaseRefusal`, which the worker and
 * the SLICE route ask too, run against the same vectors. Orca slices one object, refuses vase mode
 * with supports on, and forces one wall, no infill and no top, so a member's own value for one of
 * those can't be what prints. The workspace keeps SLICE PLATE off with this sentence.
 */
export function vaseRefusal(
  process: Record<string, SettingValue>,
  overrides: ProcessOverrides,
  copies: number,
): string | null {
  const value = (key: string) => overrides[key] ?? process[key]
  if (value('spiral_mode') !== true) return null
  if (copies > 1) return 'Vase mode prints one object at a time. Remove the other copies or turn it off.'
  if (value('enable_support') === true) {
    return "Vase mode can't have supports. Switch Supports off in the Support tab, or turn Vase mode off."
  }
  const names = VASE_FORCES.filter(([key, forced]) => overrides[key] !== undefined && overrides[key] !== forced).map(
    ([key]) => byKey.get(key)!.label,
  )
  if (names.length === 0) return null
  const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!}`
  return `Vase mode prints one wall, with no infill or top. Reset ${list}, or turn Vase mode off.`
}
