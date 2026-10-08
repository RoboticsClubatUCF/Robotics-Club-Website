/**
 * The slicer worker: its own process in its own container (`orca/Dockerfile`), beside the API.
 *
 * It claims jobs from Postgres, one at a time: STEP uploads to mesh first, since a plate can't
 * slice until they're done, then plates to slice. Nothing reaches it over the network; it reads
 * and writes rows. It refuses to start unless Orca's version and every approved profile match
 * `orca/profiles/manifest.json`, so a worker can't slice with settings the API didn't promise.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { prisma } from './core/db.js'
import { env } from './core/env.js'
import { OrcaRunner, orcaVersion } from './printing/orcaRunner.js'
import { loadApprovedProfiles, profilesDir, sliceManifest } from './printing/profiles.js'
import { meshStepInChild } from './printing/stepMesh.js'
import {
  type ClaimedMesh,
  type ClaimedSlice,
  claimMesh,
  claimSlice,
  failMesh,
  failSlice,
  heartbeat,
  publishMesh,
  publishSlice,
  renewMesh,
  renewSlice,
  retrySlice,
} from './printing/sliceJobs.js'
import { MeshError, parseStl } from './printing/stl.js'

const BEAT_MS = 20_000
const IDLE_MS = 2_000

const manifest = sliceManifest()
if (!manifest) {
  console.error('slicer: no approved profiles, so nothing to slice with')
  process.exit(1)
}
if (profilesDir.includes(';')) {
  // `--load-settings` splits its argument on semicolons.
  console.error(`slicer: the profiles path can't contain ";" (${profilesDir})`)
  process.exit(1)
}
const profiles = loadApprovedProfiles(manifest)

const scratch = env.SLICER_SCRATCH_DIR ?? join(tmpdir(), 'rccf-slicer')
await mkdir(scratch, { recursive: true, mode: 0o700 })

const version = await orcaVersion(env.ORCA_BINARY, scratch)
if (version !== manifest.orcaVersion) {
  console.error(
    `slicer: Orca reports ${String(version)}, the profiles were approved for ${manifest.orcaVersion}`,
  )
  process.exit(1)
}

const runner = new OrcaRunner(profiles, scratch, version)
const workerId = hostname()
let stopping = false
let current: AbortController | null = null

console.log(`slicer: OrcaSlicer ${version}, profiles ${manifest.profileSetHash.slice(0, 12)}`)

async function beat() {
  try {
    await heartbeat(workerId, version!, manifest!.profileSetHash)
    // The container's health check reads this file's age.
    await writeFile(join(scratch, 'heartbeat'), new Date().toISOString())
  } catch (error) {
    console.error('slicer: heartbeat failed', error)
  }
}
await beat()
const beating = setInterval(() => void beat(), BEAT_MS)

/** Keeps a job's lease alive; aborts the job if somebody else now owns it. */
function holdLease(renew: () => Promise<boolean>, controller: AbortController) {
  return setInterval(() => {
    void renew()
      .then((held) => {
        if (!held) controller.abort()
      })
      .catch((error: unknown) => console.error('slicer: lease renewal failed', error))
  }, BEAT_MS)
}

async function meshBytes(modelId: string): Promise<Float32Array | null> {
  const model = await prisma.printModel.findUnique({
    where: { id: modelId },
    select: { fileId: true, meshFileId: true },
  })
  const fileId = model?.meshFileId ?? model?.fileId
  if (!fileId) return null
  const file = await prisma.storedFile.findUnique({ where: { id: fileId }, select: { data: true } })
  return file ? parseStl(new Uint8Array(file.data)) : null
}

async function runSlice(job: ClaimedSlice) {
  const controller = new AbortController()
  current = controller
  const lease = holdLease(() => renewSlice(job.id, job.leaseToken), controller)
  const started = Date.now()
  try {
    const meshes = new Map<string, Float32Array>()
    for (const model of job.spec.models) {
      const positions = await meshBytes(model.id).catch((error: unknown) => {
        if (error instanceof MeshError) return null
        throw error
      })
      if (!positions) {
        await failSlice(job.id, job.leaseToken, 'A model on this plate changed. Slice again.', true)
        return
      }
      meshes.set(model.id, positions)
    }

    const result = await runner.slice(
      job,
      meshes,
      started + env.SLICER_TIMEOUT_SECONDS * 1000,
      controller.signal,
    )
    if (controller.signal.aborted) return

    if ('failure' in result) {
      if (result.detail) console.warn(`slicer: ${job.id}: ${result.detail}`)
      if (result.transient) await retrySlice(job.id, job.leaseToken, job.attempts)
      else await failSlice(job.id, job.leaseToken, result.failure, result.retryable)
      return
    }

    const published = await publishSlice(job.id, job.leaseToken, result)
    console.log(
      `slicer: ${job.id} ${published ? 'ready' : 'superseded'} in ${String(Math.round((Date.now() - started) / 1000))}s, ${result.grams.toFixed(1)} g`,
    )
  } catch (error) {
    console.error(`slicer: ${job.id} failed`, error)
    await retrySlice(job.id, job.leaseToken, job.attempts).catch(() => undefined)
  } finally {
    clearInterval(lease)
    current = null
  }
}

async function runMesh(job: ClaimedMesh) {
  const controller = new AbortController()
  current = controller
  const lease = holdLease(() => renewMesh(job.id, job.leaseToken), controller)
  const dir = join(scratch, `mesh-${job.id}-${job.leaseToken}`)
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const file = await prisma.storedFile.findUnique({
      where: { id: job.fileId },
      select: { data: true },
    })
    if (!file) {
      await failMesh(job.id, job.leaseToken, 'The upload was removed before it could be converted.')
      return
    }
    const meshed = await meshStepInChild(
      new Uint8Array(file.data),
      dir,
      env.SLICER_TIMEOUT_SECONDS * 1000,
      controller.signal,
    )
    if (controller.signal.aborted) return
    if (!meshed.ok) {
      console.warn(`slicer: mesh ${job.id}: ${meshed.detail}`)
      await failMesh(job.id, job.leaseToken, meshed.failure)
      return
    }

    const name = `${job.fileName.replace(/\.(step|stp)$/i, '')}.stl`
    await publishMesh(job.id, job.leaseToken, meshed.stl, name, meshed.triangles)
  } catch (error) {
    console.error(`slicer: mesh ${job.id} failed`, error)
    await failMesh(job.id, job.leaseToken, "This STEP file couldn't be converted.").catch(
      () => undefined,
    )
  } finally {
    clearInterval(lease)
    current = null
    await rm(dir, { recursive: true, force: true })
  }
}

async function loop() {
  while (!stopping) {
    try {
      const mesh = await claimMesh()
      if (mesh) {
        await runMesh(mesh)
        continue
      }
      const slice = await claimSlice()
      if (slice) {
        await runSlice(slice)
        continue
      }
    } catch (error) {
      console.error('slicer: claiming failed', error)
    }
    await new Promise((resolve) => setTimeout(resolve, IDLE_MS))
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return
    stopping = true
    clearInterval(beating)
    // The job's lease runs out and the next worker takes it; nothing half-done is published.
    current?.abort()
    setTimeout(() => process.exit(0), 5_000).unref()
  })
}

await loop()
await prisma.$disconnect()
process.exit(0)
