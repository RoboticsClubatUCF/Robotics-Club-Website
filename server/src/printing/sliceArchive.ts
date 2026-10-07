import { strFromU8, unzipSync } from 'fflate'

/**
 * Reading back the `.3mf` Orca exported after slicing, and refusing one that isn't what was asked
 * for.
 *
 * Orca's exit code alone doesn't say the plate came out right. Anything it couldn't fit goes onto
 * a second plate; an object off the bed is flagged `outside`; a preset it couldn't apply is
 * quietly replaced. So the worker checks the archive itself before an officer can ever download
 * it.
 */

export class ArchiveError extends Error {
  constructor(
    message: string,
    readonly reason: 'doesntFit' | 'mismatch' | 'broken',
  ) {
    super(message)
  }
}

export interface SliceSummary {
  grams: number
  seconds: number
  meters: number | null
  /** `Metadata/plate_1.gcode`, for the preview. */
  gcode: Uint8Array
}

export interface Expected {
  objects: number
  /** Different models on the plate. Orca's project must still hold that many meshes. */
  meshes: number
  printer: string
  process: string
  filament: string
  bedType: string
  /** Process keys as Orca strings; each must be in the project exactly. */
  overrides: Record<string, string>
}

const REQUIRED = [
  '3D/3dmodel.model',
  'Metadata/project_settings.config',
  'Metadata/slice_info.config',
  'Metadata/plate_1.gcode',
]

const attribute = (tag: string, name: string) =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1]

function plateMetadata(sliceInfo: string): Map<string, string> {
  const plate = /<plate>([\s\S]*?)<\/plate>/.exec(sliceInfo)?.[1]
  if (!plate) throw new ArchiveError('Orca wrote no plate summary', 'broken')
  const values = new Map<string, string>()
  for (const match of plate.matchAll(/<metadata\b[^>]*>/g)) {
    const key = attribute(match[0], 'key')
    const value = attribute(match[0], 'value')
    if (key !== undefined && value !== undefined) values.set(key, value)
  }
  return values
}

export function readSlicedProject(bytes: Uint8Array, expected: Expected): SliceSummary {
  const names: string[] = []
  const entries = unzipSync(bytes, {
    filter: (file) => {
      names.push(file.name)
      return REQUIRED.includes(file.name)
    },
  })

  for (const name of REQUIRED) {
    if (!entries[name]) throw new ArchiveError(`Orca's project has no ${name}`, 'broken')
  }
  if (names.some((name) => /^Metadata\/plate_([2-9]|\d{2,})\.gcode$/.test(name))) {
    throw new ArchiveError('Orca needed a second plate', 'doesntFit')
  }

  const sliceInfo = strFromU8(entries['Metadata/slice_info.config']!)
  const plate = plateMetadata(sliceInfo)
  if (plate.get('outside') === 'true') {
    throw new ArchiveError('Orca marked part of the plate as outside the bed', 'doesntFit')
  }

  const printed = [...sliceInfo.matchAll(/<object\b[^>]*>/g)].filter(
    (match) => attribute(match[0], 'skipped') !== 'true',
  ).length
  if (printed !== expected.objects) {
    throw new ArchiveError(
      `Orca printed ${String(printed)} of ${String(expected.objects)} objects`,
      'doesntFit',
    )
  }

  // Copies of one model share a mesh file in Orca's export; different models never do. Fewer
  // distinct meshes than models means Orca loaded the wrong geometry for some copy.
  const paths = new Set(
    [...strFromU8(entries['3D/3dmodel.model']!).matchAll(/<component\b[^>]*\bp:path="([^"]+)"/g)].map(
      (match) => match[1],
    ),
  )
  if (paths.size !== expected.meshes) {
    throw new ArchiveError(
      `Orca's project has ${String(paths.size)} meshes for ${String(expected.meshes)} models`,
      'mismatch',
    )
  }

  const grams = Number(plate.get('weight'))
  const seconds = Number(plate.get('prediction'))
  if (!Number.isFinite(grams) || grams <= 0 || !Number.isFinite(seconds) || seconds <= 0) {
    throw new ArchiveError('Orca gave no estimate for the plate', 'broken')
  }
  const filament = /<filament\b[^>]*>/.exec(sliceInfo)?.[0]
  const meters = filament ? Number(attribute(filament, 'used_m')) : Number.NaN

  checkSettings(strFromU8(entries['Metadata/project_settings.config']!), expected)

  return {
    grams,
    seconds: Math.round(seconds),
    meters: Number.isFinite(meters) ? meters : null,
    gcode: entries['Metadata/plate_1.gcode']!,
  }
}

/** The project has to say it was sliced with the approved presets and the member's settings. */
function checkSettings(text: string, expected: Expected) {
  let settings: Record<string, unknown>
  try {
    settings = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new ArchiveError('Orca wrote unreadable project settings', 'broken')
  }
  const first = (value: unknown) => (Array.isArray(value) ? value[0] : value)

  const wanted: [string, unknown, string][] = [
    ['printer_settings_id', settings['printer_settings_id'], expected.printer],
    ['print_settings_id', settings['print_settings_id'], expected.process],
    ['filament_settings_id', first(settings['filament_settings_id']), expected.filament],
    ['curr_bed_type', settings['curr_bed_type'], expected.bedType],
    ...Object.entries(expected.overrides).map(
      ([key, value]): [string, unknown, string] => [key, first(settings[key]), value],
    ),
  ]
  // Orca rewrites numbers its own way ("1.0" comes back "1"), so numbers compare as numbers.
  const same = (actual: unknown, value: string) => {
    if (actual === value) return true
    if (typeof actual !== 'string') return false
    const a = Number(actual.replace(/%$/, ''))
    const b = Number(value.replace(/%$/, ''))
    return (
      actual.endsWith('%') === value.endsWith('%') &&
      Number.isFinite(a) &&
      Number.isFinite(b) &&
      Math.abs(a - b) < 1e-6
    )
  }
  for (const [key, actual, value] of wanted) {
    if (!same(actual, value)) {
      throw new ArchiveError(
        `Orca sliced with ${key} = ${JSON.stringify(actual)}, not ${JSON.stringify(value)}`,
        'mismatch',
      )
    }
  }
}
