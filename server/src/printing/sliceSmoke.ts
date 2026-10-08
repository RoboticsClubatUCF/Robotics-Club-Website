/**
 * Slices real plates with the real Orca, inside the worker image. CI runs it with no network:
 *
 *   docker run --rm --network none --read-only --tmpfs /tmp --tmpfs /scratch:uid=10001 \
 *     -e DATABASE_URL=postgres://unused rccf-v13-slicer node --import tsx src/printing/sliceSmoke.ts
 *
 * It needs no database: it drives `OrcaRunner` directly, the way the worker does after claiming a
 * job. Exits non-zero if any plate doesn't come out as expected. With `SMOKE_OUT=<dir>` mounted
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
import { loadApprovedProfiles, sliceManifest } from './profiles.js'
import type { ProcessOverrides } from './processSettings.js'
import type { ClaimedSlice, PlateSpec, SliceOutput } from './sliceJobs.js'
import { meshStepInChild } from './stepMesh.js'
import { parseStl } from './stl.js'

const fixtures = fileURLToPath(new URL('../../orca/fixtures/', import.meta.url))

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
  material: PlateSpec['material']
  preset: PlateSpec['preset']
  overrides?: ProcessOverrides
  objects: { model: string; placement: Placement }[]
  /** A refusal this plate must get, or nothing for a plate that must slice. */
  refusal?: string
  /** Check the extrusions land where the objects were put, within this many mm. */
  boundsWithin?: number
}

async function main() {
  const manifest = sliceManifest()
  if (!manifest) throw new Error('no manifest')
  const profiles = loadApprovedProfiles(manifest)
  const scratch = env.SLICER_SCRATCH_DIR ?? join(tmpdir(), 'rccf-slicer-smoke')
  const version = await orcaVersion(env.ORCA_BINARY, scratch)
  if (version !== manifest.orcaVersion) {
    throw new Error(
      `Orca is ${String(version)}, the profiles want ${manifest.orcaVersion}`,
    )
  }
  const runner = new OrcaRunner(profiles, scratch, version)

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

  let failed = 0
  for (const [index, test] of cases.entries()) {
    const used = [...new Set(test.objects.map((object) => object.model))]
    const job: ClaimedSlice = {
      id: `smoke-${String(index)}`,
      requestId: 'smoke',
      fingerprint: 'smoke',
      leaseToken: 'smoke',
      attempts: 1,
      spec: {
        material: test.material,
        preset: test.preset,
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
    console.error(`${String(failed)} of ${String(cases.length)} plates failed`)
    process.exit(1)
  }
  console.log(`all ${String(cases.length)} plates as expected`)
}

await main()
