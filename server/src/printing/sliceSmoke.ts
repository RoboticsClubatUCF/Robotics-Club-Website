/**
 * Slices real plates with the real Orca, inside the worker image. CI runs it with no network:
 *
 *   docker run --rm --network none --read-only --tmpfs /tmp --tmpfs /scratch:uid=10001 \
 *     -e DATABASE_URL=postgres://unused rccf-v13-slicer node --import tsx src/printing/sliceSmoke.ts
 *
 * It needs no database. It resolves the club's own exports in `orca/source/` against the image's
 * stock profiles, the way the worker resolves an officer's upload, test-slices them the way it
 * tests one, and then drives `OrcaRunner` directly, the way the worker does after claiming a job.
 * Exits non-zero if anything doesn't come out as expected. With `SMOKE_OUT=<dir>` mounted
 * writable, each sliced plate's `.3mf` and preview are saved there to open in desktop Orca.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'fflate'
import { env } from '../core/env.js'
import { FAILURES, OrcaRunner, type SliceFailure, orcaVersion } from './orcaRunner.js'
import { type Placement, placedBox, placementAffine } from './plateTransform.js'
import type { ProcessOverrides } from './processSettings.js'
import {
  type FilamentInfo,
  type PrinterInfo,
  type ProcessInfo,
  type ProfileKind,
  ProfileError,
  StockProfiles,
  readPresetFile,
  resolvePreset,
  sha256,
} from './profileResolve.js'
import { testSlice } from './profileWork.js'
import type { LoadedProfile, SliceProfiles } from './profiles.js'
import type { ClaimedSlice, SliceOutput } from './sliceJobs.js'
import { meshStepInChild } from './stepMesh.js'
import { parseStl } from './stl.js'

const fixtures = fileURLToPath(new URL('../../orca/fixtures/', import.meta.url))
const sources = fileURLToPath(new URL('../../orca/source/', import.meta.url))

const PROCESSES = {
  STANDARD: 'process/0.20mm, 0.4 nozzle, Line, T-Support.json',
  Q: 'process/0.20mm, Q, 0.4 nozzle, Line, T-Support.json',
  QS: 'process/0.20mm, Q-S, 0.4 nozzle, Line, T-Support.json',
} as const

const FILAMENTS = {
  PLA: ['Generic PLA.orca_filament', 'System/Elegoo Rapid PLA.json'],
  PETG: ['Elegoo Rapid PETG.orca_filament', 'ECC/Elegoo RAPID PETG Optimized.json'],
} as const

async function presetsIn(bundle: string) {
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

/** The club's exports, resolved the way the worker resolves an upload. */
async function clubProfiles(stock: StockProfiles) {
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

/** A box whose raw coordinates start at `origin`, so placement has to recentre it. */
function box(
  w: number,
  d: number,
  h: number,
  origin: [number, number, number] = [0, 0, 0],
) {
  const [ox, oy, oz] = origin
  const v = [
    [0, 0, 0],
    [w, 0, 0],
    [w, d, 0],
    [0, d, 0],
    [0, 0, h],
    [w, 0, h],
    [w, d, h],
    [0, d, h],
  ].map(([x, y, z]) => [x! + ox, y! + oy, z! + oz])
  const faces = [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [1, 2, 6],
    [1, 6, 5],
    [2, 3, 7],
    [2, 7, 6],
    [3, 0, 4],
    [3, 4, 7],
  ]
  return Float32Array.from(faces.flatMap((face) => face.flatMap((i) => v[i]!)))
}

/** A many-sided cylinder, so the slice has arcs in it. */
function cylinder(radius: number, height: number, sides = 128) {
  const out: number[] = []
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * 2 * Math.PI
    const b = ((i + 1) / sides) * 2 * Math.PI
    const p = [radius * Math.cos(a), radius * Math.sin(a)]
    const q = [radius * Math.cos(b), radius * Math.sin(b)]
    out.push(0, 0, 0, q[0]!, q[1]!, 0, p[0]!, p[1]!, 0)
    out.push(0, 0, height, p[0]!, p[1]!, height, q[0]!, q[1]!, height)
    out.push(p[0]!, p[1]!, 0, q[0]!, q[1]!, 0, q[0]!, q[1]!, height)
    out.push(p[0]!, p[1]!, 0, q[0]!, q[1]!, height, p[0]!, p[1]!, height)
  }
  return Float32Array.from(out)
}

const at = (x: number, y: number, extra: Partial<Placement> = {}): Placement => ({
  x,
  y,
  qx: 0,
  qy: 0,
  qz: 0,
  qw: 1,
  sx: 1,
  sy: 1,
  sz: 1,
  ...extra,
})

interface Case {
  name: string
  material: keyof typeof FILAMENTS
  preset: keyof typeof PROCESSES
  overrides?: ProcessOverrides
  objects: { model: string; placement: Placement }[]
  /** A refusal this plate must get, or nothing for a plate that must slice. */
  refusal?: string
  /** Check the extrusions land where the objects were put, within this many mm. */
  boundsWithin?: number
}

async function main() {
  const scratch = env.SLICER_SCRATCH_DIR ?? join(tmpdir(), 'rccf-slicer-smoke')
  const version = await orcaVersion(env.ORCA_BINARY, scratch)
  if (!version) throw new Error(`${env.ORCA_BINARY} didn't say which OrcaSlicer it is`)
  const runner = new OrcaRunner(scratch, version)
  const stock = await StockProfiles.load(env.ORCA_PROFILES_DIR)
  let failed = 0

  // Every preset in the club's bundles flattens, not just the ones offered.
  let flattened = 0
  for (const bundle of ['CC1.orca_printer', 'Generic PLA.orca_filament', 'Elegoo Rapid PETG.orca_filament']) {
    const presets = await presetsIn(bundle)
    const cc1 = presets.find((p) => p.kind === 'PRINTER')
    const printer = cc1 ? await resolvePreset(cc1.text, 'PRINTER', stock) : null
    for (const preset of presets) {
      try {
        await resolvePreset(
          preset.text,
          preset.kind as ProfileKind,
          stock,
          printer?.kind === 'PRINTER' ? { name: cc1!.name, info: printer.info } : undefined,
        )
        flattened++
      } catch (error) {
        failed++
        console.error(`FAIL ${bundle}: ${preset.entry} didn't resolve:`, error)
      }
    }
  }
  console.log(`ok   ${String(flattened)} presets in the club's bundles resolve`)

  const club = await clubProfiles(stock)
  const plate = (material: keyof typeof FILAMENTS, preset: keyof typeof PROCESSES): SliceProfiles => ({
    printer: club.printer,
    process: club.processes[preset],
    filament: club.filaments[material],
  })

  // The worker's test of an upload: a good one slices, and one Orca can't slice is refused.
  const deadline = () => Date.now() + env.SLICER_TIMEOUT_SECONDS * 1000
  const started = Date.now()
  const good = await testSlice(runner, plate('PETG', 'QS'), deadline())
  if (good) {
    failed++
    console.error(`FAIL the test cube didn't slice with the club's profiles: ${good}`)
  } else {
    console.log(`ok   test cube slices (${((Date.now() - started) / 1000).toFixed(1)}s)`)
  }
  const broken = JSON.parse(club.processes.STANDARD.text) as Record<string, unknown>
  broken['layer_height'] = '5'
  const brokenText = JSON.stringify(broken)
  const refused = await testSlice(
    runner,
    { ...plate('PLA', 'STANDARD'), process: { ...club.processes.STANDARD, id: 'broken', text: brokenText } },
    deadline(),
  )
  if (refused) console.log(`ok   a 5 mm layer height is refused: ${refused}`)
  else {
    failed++
    console.error('FAIL a 5 mm layer height sliced')
  }
  try {
    await resolvePreset(
      JSON.stringify({ name: 'Nobody', inherits: 'No Such Printer 0.4 nozzle', printer_settings_id: 'Nobody' }),
      'PRINTER',
      stock,
    )
    failed++
    console.error('FAIL a printer with an unknown parent resolved')
  } catch (error) {
    if (!(error instanceof ProfileError)) throw error
    console.log(`ok   an unknown parent is refused: ${error.message}`)
  }

  // The STEP goes through the child process the worker uses, not an in-process call.
  const stepDir = join(scratch, 'smoke-step')
  await mkdir(stepDir, { recursive: true, mode: 0o700 })
  const step = await meshStepInChild(
    new Uint8Array(await readFile(join(fixtures, 'cube.step'))),
    stepDir,
    env.SLICER_TIMEOUT_SECONDS * 1000,
  )
  await rm(stepDir, { recursive: true, force: true })
  if (!step.ok)
    throw new Error(`the STEP fixture didn't mesh: ${step.failure} ${step.detail}`)
  console.log(`ok   STEP meshed in a child process: ${String(step.triangles)} triangles`)

  const meshes = new Map<string, Float32Array>([
    ['cube', box(20, 20, 20, [100, 100, 50])],
    ['bar', box(60, 10, 8)],
    ['tower', box(20, 20, 60)],
    ['cylinder', cylinder(15, 10)],
    ['step', parseStl(step.stl)],
  ])

  const turn45 = { qz: Math.sin(Math.PI / 8), qw: Math.cos(Math.PI / 8) }
  const cases: Case[] = [
    {
      name: 'one cube, PLA, Standard',
      material: 'PLA',
      preset: 'STANDARD',
      objects: [{ model: 'cube', placement: at(128, 128) }],
      boundsWithin: 1,
    },
    {
      name: 'four copies of three models, turned and scaled, Q with overrides',
      material: 'PLA',
      preset: 'Q',
      overrides: {
        layer_height: 0.16,
        wall_loops: 4,
        sparse_infill_density: 25,
        sparse_infill_pattern: 'gyroid',
        top_shell_thickness: 1.2,
        seam_position: 'back',
        enable_support: false,
      },
      objects: [
        { model: 'cube', placement: at(60, 60) },
        { model: 'cube', placement: at(60, 110, { ...turn45 }) },
        {
          model: 'bar',
          placement: at(150, 90, { ...turn45, sx: 1.5, sy: 1.5, sz: 1.5 }),
        },
        { model: 'cylinder', placement: at(120, 190) },
      ],
      boundsWithin: 1,
    },
    {
      name: 'STEP in PETG, Q-S, with a brim',
      material: 'PETG',
      preset: 'QS',
      overrides: { brim_type: 'outer_only', brim_width: 4 },
      objects: [{ model: 'step', placement: at(100, 150) }],
    },
    {
      name: 'off the plate',
      material: 'PLA',
      preset: 'STANDARD',
      objects: [{ model: 'cube', placement: at(5, 128) }],
      refusal: FAILURES.offPlate,
    },
    {
      name: 'too tall',
      material: 'PLA',
      preset: 'STANDARD',
      objects: [{ model: 'tower', placement: at(128, 128, { sz: 5 }) }],
      refusal: FAILURES.tooTall,
    },
    {
      name: 'in the purge corner',
      material: 'PLA',
      preset: 'STANDARD',
      objects: [{ model: 'cube', placement: at(240, 14) }],
      refusal: FAILURES.noGo,
    },
    {
      name: 'vase mode with two copies',
      material: 'PLA',
      preset: 'STANDARD',
      overrides: { spiral_mode: true },
      objects: [
        { model: 'cylinder', placement: at(80, 128) },
        { model: 'cylinder', placement: at(160, 128) },
      ],
      refusal: FAILURES.vase,
    },
  ]

  for (const [index, test] of cases.entries()) {
    const used = [...new Set(test.objects.map((object) => object.model))]
    const job: ClaimedSlice = {
      id: `smoke-${String(index)}`,
      requestId: 'smoke',
      fingerprint: 'smoke',
      leaseToken: 'smoke',
      attempts: 1,
      spec: {
        profiles: {
          printer: { id: club.printer.id, sha256: sha256(club.printer.text) },
          process: { id: club.processes[test.preset].id, sha256: sha256(club.processes[test.preset].text) },
          filament: { id: club.filaments[test.material].id, sha256: sha256(club.filaments[test.material].text) },
        },
        overrides: test.overrides ?? {},
        models: used.map((id) => ({ id, sha256: id, fileName: `${id}.stl` })),
        objects: test.objects.map((object) => ({
          modelId: object.model,
          name: object.model,
          ...object.placement,
        })),
      },
    }
    const started = Date.now()
    const result: SliceOutput | SliceFailure = await runner.slice(
      job,
      plate(test.material, test.preset),
      meshes,
      Date.now() + env.SLICER_TIMEOUT_SECONDS * 1000,
    )
    const seconds = ((Date.now() - started) / 1000).toFixed(1)

    if (test.refusal) {
      if ('failure' in result && result.failure === test.refusal) {
        console.log(`ok   ${test.name}: refused (${seconds}s)`)
      } else {
        failed++
        console.error(`FAIL ${test.name}: wanted "${test.refusal}", got`, result)
      }
      continue
    }

    if ('failure' in result) {
      failed++
      console.error(`FAIL ${test.name}: ${result.failure}\n${result.detail ?? ''}`)
      continue
    }

    const problems: string[] = []
    if (!(result.grams > 0)) problems.push('no grams')
    if (!result.preview) problems.push(`no preview: ${String(result.previewFailure)}`)

    if (result.preview && test.boundsWithin !== undefined) {
      const raw = gunzipSync(result.preview)
      const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
      const got = [0, 1, 3, 4].map((slot) => view.getFloat32(28 + slot * 4, true))
      const want = [Infinity, Infinity, -Infinity, -Infinity]
      for (const object of test.objects) {
        const positions = meshes.get(object.model)!
        const placed = placedBox(positions, placementAffine(positions, object.placement))
        want[0] = Math.min(want[0]!, placed.min[0])
        want[1] = Math.min(want[1]!, placed.min[1])
        want[2] = Math.max(want[2]!, placed.max[0])
        want[3] = Math.max(want[3]!, placed.max[1])
      }
      const off = Math.max(...got.map((value, i) => Math.abs(value - want[i]!)))
      if (off > test.boundsWithin) {
        problems.push(
          `extrusions are ${off.toFixed(2)} mm from where the objects were put`,
        )
      }
    }

    const out = process.env['SMOKE_OUT']
    if (out) {
      await writeFile(join(out, `plate-${String(index + 1)}.3mf`), result.output)
      if (result.preview)
        await writeFile(join(out, `plate-${String(index + 1)}.rcpv`), result.preview)
    }

    if (problems.length > 0) {
      failed++
      console.error(`FAIL ${test.name}: ${problems.join('; ')}`)
    } else {
      console.log(
        `ok   ${test.name}: ${result.grams.toFixed(1)} g, ${String(Math.round(result.seconds / 60))} min, ${String(result.layerCount)} layers, ${String(Math.round(result.output.byteLength / 1024))} KB (${seconds}s)`,
      )
    }
  }

  if (failed > 0) {
    console.error(`${String(failed)} checks failed`)
    process.exit(1)
  }
  console.log(`all ${String(cases.length)} plates as expected`)
}

await main()
