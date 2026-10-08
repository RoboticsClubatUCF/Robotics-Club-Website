/**
 * The slicer worker: its own process in its own container (`orca/Dockerfile`), beside the API.
 *
 * It claims jobs from Postgres, one at a time: officers' profile uploads first, since nothing can
 * slice with one until it's resolved, then STEP uploads to mesh, then plates to slice. Nothing
 * reaches it over the network; it reads and writes rows. Every profile it slices with is one it
 * resolved itself, against this Orca's stock profiles, and a job whose profiles changed after
 * SLICE was pressed is refused.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { prisma } from './core/db.js'
import { env } from './core/env.js'
import { OrcaRunner, orcaVersion } from './printing/orcaRunner.js'
import {
  type ClaimedProfile,
  claimProfile,
  failProfile,
  publishProfile,
  renewProfile,
  requeueOtherVersions,
} from './printing/profileJobs.js'
import { StockProfiles } from './printing/profileResolve.js'
import { resolveProfile } from './printing/profileWork.js'
import { loadSliceProfiles } from './printing/profiles.js'
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

const scratch = env.SLICER_SCRATCH_DIR ?? join(tmpdir(), 'rccf-slicer')
if (scratch.includes(';')) {
  // `--load-settings` splits its argument on semicolons, and the profiles are written under here.
  console.error(`slicer: the scratch path can't contain ";" (${scratch})`)
  process.exit(1)
}
await mkdir(scratch, { recursive: true, mode: 0o700 })

const version = await orcaVersion(env.ORCA_BINARY, scratch)
if (!version) {
  console.error(`slicer: ${env.ORCA_BINARY} didn't say which OrcaSlicer it is`)
  process.exit(1)
}
const stock = await StockProfiles.load(env.ORCA_PROFILES_DIR)

const runner = new OrcaRunner(scratch, version)
const workerId = hostname()
let stopping = false
let current: AbortController | null = null

const requeued = await requeueOtherVersions(version)
console.log(
  `slicer: OrcaSlicer ${version}${requeued > 0 ? `, resolving ${String(requeued)} profiles again for it` : ''}`,
)

async function beat() {
  try {
    await heartbeat(workerId, version!)
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
  const file = await prisma.storedFile.findUnique({
    where: { id: fileId },
    select: { data: true },
  })
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
        await failSlice(
          job.id,
          job.leaseToken,
          'A model on this plate changed. Slice again.',
          true,
        )
        return
      }
      meshes.set(model.id, positions)
    }

    const profiles = await loadSliceProfiles(job.spec.profiles, version!)
    if (!profiles) {
      await failSlice(
        job.id,
        job.leaseToken,
        'A printer, process or filament on this plate changed. Slice again.',
        true,
      )
      return
    }

    const result = await runner.slice(
      job,
      profiles,
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
      await failMesh(
        job.id,
        job.leaseToken,
        'The upload was removed before it could be converted.',
      )
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

async function runProfile(job: ClaimedProfile) {
  const controller = new AbortController()
  current = controller
  const lease = holdLease(() => renewProfile(job.id, job.leaseToken), controller)
  const started = Date.now()
  try {
    const outcome = await resolveProfile(
      job,
      stock,
      runner,
      started + env.SLICER_TIMEOUT_SECONDS * 1000,
      controller.signal,
    )
    if (controller.signal.aborted) return
    if ('failure' in outcome) {
      console.warn(`slicer: profile ${job.name}: ${outcome.failure}`)
      await failProfile(job.id, job.leaseToken, outcome.failure, version!)
      return
    }
    await publishProfile(job.id, job.leaseToken, { ...outcome, orcaVersion: version! })
    console.log(
      `slicer: profile ${job.name} ready in ${String(Math.round((Date.now() - started) / 1000))}s`,
    )
  } catch (error) {
    console.error(`slicer: profile ${job.name} failed`, error)
    await failProfile(
      job.id,
      job.leaseToken,
      `Something went wrong setting it up. Upload it again, and if it keeps failing, check the slicer's log.`,
      version!,
    ).catch(() => undefined)
  } finally {
    clearInterval(lease)
    current = null
  }
}

async function loop() {
  while (!stopping) {
    try {
      const profile = await claimProfile()
      if (profile) {
        await runProfile(profile)
        continue
      }
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
