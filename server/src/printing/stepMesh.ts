import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import occtimportjs from 'occt-import-js'
import { runProcess } from './runProcess.js'
import { MeshError } from './stl.js'

/**
 * A STEP file as one triangle soup, every body in its assembly position.
 *
 * Orca's CLI can't open STEP (only its desktop app can), so the worker meshes it first with the
 * same tolerances desktop Orca uses by default.
 */
export async function meshStep(bytes: Uint8Array): Promise<Float32Array> {
  const occt = await occtimportjs()
  const result = occt.ReadStepFile(bytes, {
    linearUnit: 'millimeter',
    linearDeflectionType: 'absolute_value',
    linearDeflection: 0.003,
    angularDeflection: 0.5,
  })
  if (!result.success) throw new MeshError(`The STEP file couldn't be read.`)

  let triangles = 0
  for (const mesh of result.meshes) triangles += mesh.index.array.length / 3
  if (triangles === 0) throw new MeshError('The STEP file has no solid bodies in it.')

  const out = new Float32Array(triangles * 9)
  let at = 0
  for (const mesh of result.meshes) {
    const position = mesh.attributes.position.array
    const index = mesh.index.array
    for (let i = 0; i < index.length; i++) {
      const vertex = index[i]! * 3
      out[at++] = position[vertex]!
      out[at++] = position[vertex + 1]!
      out[at++] = position[vertex + 2]!
    }
  }
  return out
}

const STEP_CLI = fileURLToPath(new URL('./stepMeshCli.ts', import.meta.url))

export type ChildMesh =
  | { ok: true; stl: Uint8Array; triangles: number }
  | { ok: false; failure: string; detail: string }

/**
 * `meshStep` in a child process, which is how the worker runs it: a hostile file can make
 * OpenCascade spin, and a child can be killed. It runs from the app's own folder, where Node finds
 * tsx and occt-import-js; only its files go in `dir`.
 */
export async function meshStepInChild(
  bytes: Uint8Array,
  dir: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ChildMesh> {
  const source = join(dir, 'in.step')
  const target = join(dir, 'out.stl')
  await writeFile(source, bytes)

  const run = await runProcess(process.execPath, [...process.execArgv, STEP_CLI, source, target], {
    cwd: process.cwd(),
    env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: dir, TMPDIR: dir },
    timeoutMs,
    signal,
  })

  let reply: { triangles?: number; error?: string } = {}
  try {
    reply = JSON.parse(run.stdout.trim().split('\n').at(-1) ?? '{}') as typeof reply
  } catch {
    // Reported below as a failure to convert.
  }
  if (run.code !== 0 || !reply.triangles) {
    return {
      ok: false,
      failure: run.timedOut
        ? 'This STEP file took too long to convert. Export it as STL and upload that.'
        : (reply.error ?? `This STEP file couldn't be converted. Export it as STL and upload that.`),
      detail: `exit ${String(run.code)} ${run.stderr.slice(-1000)}`,
    }
  }
  return { ok: true, stl: new Uint8Array(await readFile(target)), triangles: reply.triangles }
}
