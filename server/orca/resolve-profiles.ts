/**
 * Builds `orca/profiles/` from the club's exported Orca bundles in `orca/source/`.
 *
 *   npx tsx orca/resolve-profiles.ts --vendor <OrcaSlicer 2.4.2>/resources/profiles
 *
 * An exported preset is a sparse diff against a stock one, and the CLI can't be trusted to find
 * that parent the way the desktop app does. So each preset is flattened here against Orca's own
 * Elegoo profiles, parent first with each child replacing whole keys (how Orca applies a preset),
 * and written out complete. The worker checks every file against `manifest.json` before it slices.
 *
 * Get the vendor folder from the slicer image:
 *   docker run --rm --entrypoint tar rccf-v13-slicer -C /opt/orca/resources/profiles -cf - Elegoo OrcaFilamentLibrary
 */
import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strFromU8, unzipSync } from 'fflate'
import {
  MATERIAL_FILES,
  PRESET_FILES,
  PROCESS_SETTINGS,
  fromOrca,
  settingDef,
} from '../src/printing/processSettings.js'

const ORCA_VERSION = '2.4.2'

const here = dirname(fileURLToPath(import.meta.url))
const sourceDir = join(here, 'source')
const outDir = join(here, 'profiles')

type Profile = Record<string, unknown>
type Kind = 'machine' | 'process' | 'filament'

interface Source {
  file: string
  kind: Kind
  bundle: string
  entry: string
}

const PRINTER: Source = {
  file: 'printer.json',
  kind: 'machine',
  bundle: 'CC1.orca_printer',
  entry: 'printer/CC1.json',
}

const PRESETS: Record<keyof typeof PRESET_FILES, Source & { label: string }> = {
  STANDARD: {
    file: PRESET_FILES.STANDARD,
    kind: 'process',
    bundle: 'CC1.orca_printer',
    entry: 'process/0.20mm, 0.4 nozzle, Line, T-Support.json',
    label: 'Standard',
  },
  Q: {
    file: PRESET_FILES.Q,
    kind: 'process',
    bundle: 'CC1.orca_printer',
    entry: 'process/0.20mm, Q, 0.4 nozzle, Line, T-Support.json',
    label: 'Q',
  },
  QS: {
    file: PRESET_FILES.QS,
    kind: 'process',
    bundle: 'CC1.orca_printer',
    entry: 'process/0.20mm, Q-S, 0.4 nozzle, Line, T-Support.json',
    label: 'Q-S',
  },
}

const MATERIALS: Record<keyof typeof MATERIAL_FILES, Source> = {
  PLA: {
    file: MATERIAL_FILES.PLA,
    kind: 'filament',
    bundle: 'Generic PLA.orca_filament',
    entry: 'System/Elegoo Rapid PLA.json',
  },
  PETG: {
    file: MATERIAL_FILES.PETG,
    kind: 'filament',
    bundle: 'Elegoo Rapid PETG.orca_filament',
    entry: 'ECC/Elegoo RAPID PETG Optimized.json',
  },
}

/**
 * Parents renamed in Orca 2.4 without a `renamed_from` alias, so 2.4 can't find them by the old
 * name. Elegoo Rapid PLA was exported against `Elegoo Generic PLA`.
 */
const RENAMED: Record<string, string> = {
  'Elegoo Generic PLA': 'Generic PLA @Elegoo',
}

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

/** `default_bed_type` on a printer is an index into this, Orca's own order. */
const BED_TYPES = [
  'Default Plate',
  'Cool Plate',
  'Engineering Plate',
  'High Temp Plate',
  'Textured PEI Plate',
  'Textured Cool Plate',
  'Supertack Plate',
]

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

function vendorArg(): string {
  const at = process.argv.indexOf('--vendor')
  const dir = at === -1 ? undefined : process.argv[at + 1]
  if (!dir) {
    console.error('usage: tsx orca/resolve-profiles.ts --vendor <orca>/resources/profiles')
    process.exit(2)
  }
  return dir
}

async function readBundleEntry(source: Source): Promise<{ profile: Profile; sha: string }> {
  const zip = unzipSync(new Uint8Array(await readFile(join(sourceDir, source.bundle))))
  const bytes = zip[source.entry]
  if (!bytes) throw new Error(`${source.bundle} has no ${source.entry}`)
  const text = strFromU8(bytes)
  return { profile: JSON.parse(text) as Profile, sha: sha256(text) }
}

async function jsonFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await jsonFiles(path)))
    else if (entry.name.endsWith('.json')) out.push(path)
  }
  return out
}

/** Every stock preset by name and by each name it used to have. */
async function vendorIndex(vendor: string) {
  const index = new Map<string, { profile: Profile; source: string }>()
  const roots = [join(vendor, 'Elegoo'), join(vendor, 'OrcaFilamentLibrary')]

  for (const root of roots) {
    for (const path of await jsonFiles(root)) {
      const profile = JSON.parse(await readFile(path, 'utf8')) as Profile
      const type = profile['type']
      if (type !== 'machine' && type !== 'process' && type !== 'filament') continue
      const source = path.slice(vendor.length + 1).replaceAll('\\', '/')
      const names = [
        String(profile['name']),
        ...String(profile['renamed_from'] ?? '')
          .split(';')
          .map((name) => name.trim())
          .filter(Boolean),
      ]
      for (const name of names) {
        const key = `${String(type)}:${name}`
        // Elegoo's own copy wins over the generic library's.
        if (!index.has(key)) index.set(key, { profile, source })
      }
    }
  }
  return index
}

type Index = Awaited<ReturnType<typeof vendorIndex>>

function flatten(child: Profile, kind: Kind, index: Index) {
  const chain: Profile[] = [child]
  const inherits: { name: string; source: string }[] = []
  const substitutions: { from: string; to: string }[] = []

  let current = child
  while (typeof current['inherits'] === 'string' && current['inherits'] !== '') {
    const asked = current['inherits']
    const name = RENAMED[asked] ?? asked
    if (name !== asked) substitutions.push({ from: asked, to: name })
    const parent = index.get(`${kind}:${name}`)
    if (!parent) throw new Error(`no stock ${kind} preset named "${name}"`)
    // Found by an old name or another casing, it's still written under its current one.
    inherits.push({ name: String(parent.profile['name']), source: parent.source })
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
  merged['type'] = kind

  return { merged, inherits, substitutions }
}

function serialise(profile: Profile): string {
  const sorted = Object.fromEntries(
    Object.keys(profile)
      .sort()
      .map((key) => [key, profile[key]]),
  )
  return `${JSON.stringify(sorted, null, '\t')}\n`
}

const first = (value: unknown): string => String(Array.isArray(value) ? value[0] : value)

function points(value: unknown): [number, number][] {
  return (value as string[]).map((point) => {
    const [x, y] = point.split('x').map(Number)
    return [x ?? Number.NaN, y ?? Number.NaN]
  })
}

/** Orca's built-in defaults (`PrintConfig.cpp`, 2.4.2) for keys no stock preset sets. */
const ORCA_DEFAULTS: Record<string, string> = {
  fuzzy_skin: 'disabled_fuzzy',
}

function presetValues(profile: Profile) {
  const values: Record<string, unknown> = {}
  for (const def of PROCESS_SETTINGS) {
    const raw = profile[def.key] ?? ORCA_DEFAULTS[def.key]
    if (raw === undefined) throw new Error(`process has no ${def.key}`)
    values[def.key] = fromOrca(def, first(raw))
  }
  return values
}

function describe(values: Record<string, unknown>): string {
  const pattern = settingDef('sparse_infill_pattern')
  const label =
    pattern?.kind === 'choice'
      ? (pattern.choices.find((choice) => choice.value === values['sparse_infill_pattern'])
          ?.label ?? String(values['sparse_infill_pattern']))
      : ''
  return `${String(values['wall_loops'])} walls, ${String(values['sparse_infill_density'])}% ${label.toLowerCase()}`
}

async function main() {
  const vendor = vendorArg()
  const index = await vendorIndex(vendor)
  const vendorMeta = JSON.parse(await readFile(join(vendor, 'Elegoo.json'), 'utf8')) as Profile

  const written: { file: string; sha256: string }[] = []
  const sources: unknown[] = []

  async function emit(source: Source, adjust?: (profile: Profile) => void) {
    const { profile, sha } = await readBundleEntry(source)
    const { merged, inherits, substitutions } = flatten(profile, source.kind, index)
    adjust?.(merged)
    const text = serialise(merged)
    await writeFile(join(outDir, source.file), text)
    const hash = sha256(text)
    written.push({ file: source.file, sha256: hash })
    sources.push({
      file: source.file,
      bundle: source.bundle,
      entry: source.entry,
      entrySha256: sha,
      inherits,
      substitutions,
    })
    return { merged, hash }
  }

  const printer = await emit(PRINTER)
  const bedIndex = Number(first(printer.merged['default_bed_type']))
  const bedType = BED_TYPES[bedIndex]
  if (!bedType) throw new Error(`unknown default_bed_type ${String(bedIndex)}`)

  const area = points(printer.merged['printable_area'])
  const exclude = points(printer.merged['bed_exclude_area'] ?? [])
  const xs = (list: [number, number][]) => list.map(([x]) => x)
  const ys = (list: [number, number][]) => list.map(([, y]) => y)

  const presets: Record<string, unknown> = {}
  for (const [key, source] of Object.entries(PRESETS)) {
    const { merged, hash } = await emit(source, (profile) => {
      // The desktop takes the plate from the printer; the CLI doesn't, falls back to Cool
      // Plate, and then refuses PETG outright.
      profile['curr_bed_type'] = bedType
      profile['post_process'] = []
    })
    const values = presetValues(merged)
    presets[key] = {
      file: source.file,
      preset: merged['name'],
      sha256: hash,
      label: source.label,
      description: describe(values),
      values,
    }
  }

  const materials: Record<string, unknown> = {}
  for (const [key, source] of Object.entries(MATERIALS)) {
    const { merged, hash } = await emit(source)
    materials[key] = { file: source.file, preset: merged['name'], sha256: hash }
  }

  const profileSetHash = sha256(
    [ORCA_VERSION, ...written.map(({ file, sha256: hash }) => `${file}:${hash}`).sort()].join('\n'),
  )

  const manifest = {
    orcaVersion: ORCA_VERSION,
    vendorProfileVersion: vendorMeta['version'],
    profileSetHash,
    printer: {
      file: PRINTER.file,
      preset: printer.merged['name'],
      sha256: printer.hash,
      model: first(printer.merged['printer_model']),
      nozzle: Number(first(printer.merged['nozzle_diameter'])),
      bedType,
      bed: {
        polygon: area,
        width: Math.max(...xs(area)) - Math.min(...xs(area)),
        depth: Math.max(...ys(area)) - Math.min(...ys(area)),
        height: Number(first(printer.merged['printable_height'])),
        exclude:
          exclude.length > 0
            ? {
                minX: Math.min(...xs(exclude)),
                minY: Math.min(...ys(exclude)),
                maxX: Math.max(...xs(exclude)),
                maxY: Math.max(...ys(exclude)),
              }
            : null,
      },
      layerHeight: {
        min: Number(first(printer.merged['min_layer_height'])),
        max: Number(first(printer.merged['max_layer_height'])),
      },
    },
    presets,
    materials,
    sources,
  }

  await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`wrote ${String(written.length)} profiles, set ${profileSetHash.slice(0, 12)}`)
}

await main()
