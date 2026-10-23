/**
 * Makes the slicer training's practice parts and slices them with the real Orca, inside the worker
 * image, so the training's previews and numbers are what the slicer really gives. Run it again
 * when the club's profiles in `orca/source/` change, or a task needs another slice. The image runs
 * its own copy of this file, so mount the one you changed:
 *
 *   docker run --rm --network none --read-only --tmpfs /tmp --tmpfs /scratch:uid=10001 \
 *     -v "<repo>/web/public/training:/out" -e TRAINING_OUT=/out \
 *     -v "<repo>/server/src/printing/trainingSlices.ts:/app/src/printing/trainingSlices.ts:ro" \
 *     -e DATABASE_URL=postgres://unused rccf-v13-slicer node --import tsx src/printing/trainingSlices.ts
 *
 * A preview's gzip header carries the time it was written, so every preview shows as changed after
 * a run. Commit only the ones whose slice did.
 *
 * It writes `parts/*.stl`, `slices/*.rcpv` (the worker's gzipped preview) and `slices.json`, which
 * `web/src/lib/training/practiceSlices.ts` reads. Every part sits at the middle of the CC1's
 * plate; the training moves a preview to wherever the member put the part.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { env } from '../core/env.js'
import { type FILAMENTS, type PROCESSES, clubProfiles } from './clubProfiles.js'
import { OrcaRunner, orcaVersion } from './orcaRunner.js'
import type { Placement } from './plateTransform.js'
import type { ProcessOverrides } from './processSettings.js'
import { StockProfiles, sha256 } from './profileResolve.js'
import type { ClaimedSlice } from './sliceJobs.js'
import { writeBinaryStl } from './stl.js'

type Point = [number, number]

/**
 * A prism: `outline` (counter-clockwise, in y and z) pushed `length` mm along x, ends covered by
 * `caps`, rectangles given by two opposite corners that tile the outline. Every cap corner is an
 * outline point, so no edge stops partway along another and Orca reads it as closed.
 */
function extrude(outline: Point[], caps: [Point, Point][], length: number): Float32Array {
  const out: number[] = []
  const tri = (...points: [number, number, number][]) => {
    for (const point of points) out.push(...point)
  }
  for (const [x, facing] of [
    [0, -1],
    [length, 1],
  ] as const) {
    for (const [[y0, z0], [y1, z1]] of caps) {
      const a: [number, number, number] = [x, y0, z0]
      const b: [number, number, number] = [x, y1, z0]
      const c: [number, number, number] = [x, y1, z1]
      const d: [number, number, number] = [x, y0, z1]
      if (facing > 0) tri(a, b, c, a, c, d)
      else tri(a, c, b, a, d, c)
    }
  }
  outline.forEach(([y0, z0], index) => {
    const [y1, z1] = outline[(index + 1) % outline.length]!
    tri([0, y0, z0], [0, y1, z1], [length, y1, z1], [0, y0, z0], [length, y1, z1], [length, y0, z0])
  })
  return Float32Array.from(out)
}

const box = (w: number, d: number, h: number) =>
  extrude(
    [
      [0, 0],
      [d, 0],
      [d, h],
      [0, h],
    ],
    [
      [
        [0, 0],
        [d, h],
      ],
    ],
    w,
  )

/** A round part: `outline` is (radius, height) from the bottom centre, up the outside, to the top centre. */
function revolve(outline: Point[], sides = 96): Float32Array {
  const out: number[] = []
  const at = (r: number, z: number, i: number) => {
    const angle = (i / sides) * 2 * Math.PI
    return [r * Math.cos(angle), r * Math.sin(angle), z]
  }
  for (let k = 0; k + 1 < outline.length; k++) {
    const [ra, za] = outline[k]!
    const [rb, zb] = outline[k + 1]!
    for (let i = 0; i < sides; i++) {
      if (ra > 0) out.push(...at(ra, za, i), ...at(ra, za, i + 1), ...at(rb, zb, i + 1))
      if (rb > 0) out.push(...at(ra, za, i), ...at(rb, zb, i + 1), ...at(rb, zb, i))
    }
  }
  return Float32Array.from(out)
}

const PARTS = {
  cube: box(20, 20, 20),
  // An L: a 24 mm foot and a 30 mm upright, 4 mm thick and 40 mm long.
  bracket: extrude(
    [
      [0, 0],
      [4, 0],
      [24, 0],
      [24, 4],
      [4, 4],
      [4, 30],
      [0, 30],
      [0, 4],
    ],
    [
      [
        [0, 0],
        [4, 4],
      ],
      [
        [4, 0],
        [24, 4],
      ],
      [
        [0, 4],
        [4, 30],
      ],
    ],
    40,
  ),
  // A 12 mm stem under a 30 mm cap: the cap's underside hangs out flat, so it needs supports
  // standing up and none upside down.
  mushroom: revolve([
    [0, 0],
    [6, 0],
    [6, 14],
    [15, 14],
    [15, 19],
    [0, 19],
  ]),
  tower: revolve([
    [0, 0],
    [4, 0],
    [4, 60],
    [0, 60],
  ]),
  block: box(30, 30, 12),
} satisfies Record<string, Float32Array>

type Part = keyof typeof PARTS

const middle: Placement = { x: 128, y: 128, qx: 0, qy: 0, qz: 0, qw: 1, sx: 1, sy: 1, sz: 1 }
const upsideDown: Placement = { ...middle, qx: 1, qw: 0 }

const NO_SUPPORT = { enable_support: false }
const NORMAL = { enable_support: true, support_type: 'normal(auto)' }
const TREE = { enable_support: true, support_type: 'tree(auto)' }
const BRIM = { brim_type: 'outer_only', brim_width: 5 }

interface Slice {
  part: Part
  placement: Placement
  overrides: ProcessOverrides
  process?: keyof typeof PROCESSES
  filament?: keyof typeof FILAMENTS
}

/**
 * The training's tasks change a setting and slice again, so each step of a task needs its slice
 * here, with every change made before it in that task. The web picks one by comparing settings
 * (`matchSlice`), so the names are only file names.
 */
const SLICES: Record<string, Slice> = {
  'mushroom-up-none': { part: 'mushroom', placement: middle, overrides: NO_SUPPORT },
  'mushroom-up-normal': { part: 'mushroom', placement: middle, overrides: NORMAL },
  'mushroom-up-tree': { part: 'mushroom', placement: middle, overrides: TREE },
  'mushroom-down': { part: 'mushroom', placement: upsideDown, overrides: TREE },
  'mushroom-up-none-brim': { part: 'mushroom', placement: middle, overrides: { ...NO_SUPPORT, ...BRIM } },
  'mushroom-up-normal-brim': { part: 'mushroom', placement: middle, overrides: { ...NORMAL, ...BRIM } },
  'mushroom-up-tree-brim': { part: 'mushroom', placement: middle, overrides: { ...TREE, ...BRIM } },
  'mushroom-down-brim': { part: 'mushroom', placement: upsideDown, overrides: { ...TREE, ...BRIM } },
  'mushroom-up-normal-raft': { part: 'mushroom', placement: middle, overrides: { ...NORMAL, raft_layers: 2 } },
  'tower-none': { part: 'tower', placement: middle, overrides: {} },
  'tower-brim': { part: 'tower', placement: middle, overrides: BRIM },
  'tower-brim-8': { part: 'tower', placement: middle, overrides: { ...BRIM, brim_width: 8 } },
  'tower-brim-8-skirt-2': { part: 'tower', placement: middle, overrides: { ...BRIM, brim_width: 8, skirt_loops: 2 } },
  // Orca refuses vase mode with supports on.
  'tower-vase': { part: 'tower', placement: middle, overrides: { ...NO_SUPPORT, spiral_mode: true } },
  'tower-fuzzy': { part: 'tower', placement: middle, overrides: { fuzzy_skin: 'external' } },
  'block-standard': { part: 'block', placement: middle, overrides: {} },
  'block-infill-40': { part: 'block', placement: middle, overrides: { sparse_infill_density: 40 } },
  'block-infill-40-gyroid': {
    part: 'block',
    placement: middle,
    overrides: { sparse_infill_density: 40, sparse_infill_pattern: 'gyroid' },
  },
  'block-infill-40-gyroid-concentric': {
    part: 'block',
    placement: middle,
    overrides: { sparse_infill_density: 40, sparse_infill_pattern: 'gyroid', top_surface_pattern: 'concentric' },
  },
  'block-gyroid': { part: 'block', placement: middle, overrides: { sparse_infill_pattern: 'gyroid' } },
  'block-walls-5': { part: 'block', placement: middle, overrides: { wall_loops: 5 } },
  'block-infill-0': { part: 'block', placement: middle, overrides: { sparse_infill_density: 0 } },
  'block-infill-100': { part: 'block', placement: middle, overrides: { sparse_infill_density: 100 } },
  'block-layer-0.12': { part: 'block', placement: middle, overrides: { layer_height: 0.12 } },
  'block-layer-0.28': { part: 'block', placement: middle, overrides: { layer_height: 0.28 } },
  'block-ironing': { part: 'block', placement: middle, overrides: { ironing_type: 'topmost' } },
  'block-petg': { part: 'block', placement: middle, overrides: {}, filament: 'PETG' },
  'block-petg-qs': { part: 'block', placement: middle, overrides: {}, process: 'QS', filament: 'PETG' },
  'block-petg-qs-walls-4': { part: 'block', placement: middle, overrides: { wall_loops: 4 }, process: 'QS', filament: 'PETG' },
}

async function main() {
  const out = process.env['TRAINING_OUT']
  if (!out) throw new Error('Set TRAINING_OUT to the folder to write into.')
  const scratch = env.SLICER_SCRATCH_DIR ?? '/tmp'
  const version = await orcaVersion(env.ORCA_BINARY, scratch)
  if (!version) throw new Error(`${env.ORCA_BINARY} didn't say which OrcaSlicer it is`)
  const stock = await StockProfiles.load(env.ORCA_PROFILES_DIR)
  const runner = new OrcaRunner(scratch, version, stock)
  const club = await clubProfiles(stock)

  await mkdir(join(out, 'parts'), { recursive: true })
  await mkdir(join(out, 'slices'), { recursive: true })
  for (const [name, positions] of Object.entries(PARTS)) {
    await writeFile(join(out, 'parts', `${name}.stl`), writeBinaryStl(positions))
  }

  const manifest: Record<string, unknown> = {}
  for (const [name, slice] of Object.entries(SLICES)) {
    const filament = club.filaments[slice.filament ?? 'PLA']
    const process_ = club.processes[slice.process ?? 'STANDARD']
    const job: ClaimedSlice = {
      id: `training-${name}`,
      requestId: 'training',
      fingerprint: name,
      leaseToken: 'training',
      attempts: 1,
      spec: {
        profiles: {
          printer: { id: club.printer.id, sha256: sha256(club.printer.text) },
          process: { id: process_.id, sha256: sha256(process_.text) },
          filament: { id: filament.id, sha256: sha256(filament.text) },
        },
        overrides: slice.overrides,
        models: [{ id: slice.part, sha256: slice.part, fileName: `${slice.part}.stl` }],
        objects: [{ modelId: slice.part, name: slice.part, ...slice.placement }],
      },
    }
    const result = await runner.slice(
      job,
      { printer: club.printer, process: process_, filament },
      new Map([[slice.part, PARTS[slice.part]]]),
      Date.now() + env.SLICER_TIMEOUT_SECONDS * 1000,
    )
    if ('failure' in result) throw new Error(`${name}: ${result.failure} ${result.detail ?? ''}`)
    if (!result.preview) throw new Error(`${name}: no preview (${String(result.previewFailure)})`)
    await writeFile(join(out, 'slices', `${name}.rcpv`), result.preview)
    const { x, y, qx, qy, qz, qw } = slice.placement
    manifest[name] = {
      part: slice.part,
      at: [x, y],
      turn: [qx, qy, qz, qw],
      overrides: slice.overrides,
      process: process_.name,
      filament: filament.name,
      grams: Math.round(result.grams * 100) / 100,
      seconds: Math.round(result.seconds),
      meters: result.meters === null ? null : Math.round(result.meters * 100) / 100,
      layers: result.layerCount,
      preview: `slices/${name}.rcpv`,
    }
    console.log(
      `ok   ${name}: ${result.grams.toFixed(1)} g, ${String(Math.round(result.seconds / 60))} min, ${String(result.layerCount)} layers${
        result.preview ? `, preview ${String(Math.round(result.preview.byteLength / 1024))} KB` : ''
      }`,
    )
  }
  await writeFile(
    join(out, 'slices.json'),
    `${JSON.stringify({ orca: version, printer: club.printer.name, slices: manifest }, null, 2)}\n`,
  )
}

await main()
