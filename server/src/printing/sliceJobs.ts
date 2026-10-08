import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { prisma } from '../core/db.js'
import type { Prisma } from '../generated/prisma/client.js'
import { FileKind, SlicerJobState } from '../generated/prisma/enums.js'
import { type ProcessOverrides, processOverrides } from './processSettings.js'

/**
 * The slicer worker's two queues, both in Postgres: meshing a STEP upload (`print_models`) and
 * slicing a plate (`print_slices`).
 *
 * A job is claimed with `FOR UPDATE SKIP LOCKED` and a lease the worker renews while it works.
 * A worker that dies leaves an expired lease, and the next claim takes the job over; after
 * `MAX_ATTEMPTS` it's failed instead, so one bad file can't wedge the queue. Results are published
 * only while the lease token still matches, so a job the member re-queued in the meantime throws
 * its answer away.
 */

export const LEASE_SECONDS = 90
export const MAX_ATTEMPTS = 2
/** How fresh a worker's heartbeat must be for SLICE to be offered. */
export const WORKER_FRESH_SECONDS = 90

const profileRef = z.object({ id: z.string(), sha256: z.string() })

/**
 * What a slice job is told to slice, frozen when SLICE is pressed. The profiles go by id and the
 * hash they had then; the worker refuses a job whose profiles have changed since.
 */
export const plateSpec = z.object({
  profiles: z.object({ printer: profileRef, process: profileRef, filament: profileRef }),
  overrides: processOverrides,
  objects: z
    .array(
      z.object({
        modelId: z.string(),
        name: z.string(),
        x: z.number(),
        y: z.number(),
        qx: z.number(),
        qy: z.number(),
        qz: z.number(),
        qw: z.number(),
        sx: z.number(),
        sy: z.number(),
        sz: z.number(),
      }),
    )
    .min(1),
  models: z.array(z.object({ id: z.string(), sha256: z.string(), fileName: z.string() })),
})

export type PlateSpec = z.infer<typeof plateSpec>

/** Keys sorted all the way down, so equal plates hash equally whatever order they were built in. */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as object)
        .sort()
        .map((key) => [key, stable((value as Record<string, unknown>)[key])]),
    )
  }
  return value
}

/**
 * The plate and everything that changes how it slices, hashed. Models are named by their bytes'
 * hash, not their row, so two uploads of one file slice the same. The copies' names are left out:
 * renaming isn't slicing, and neither is renaming a profile.
 */
export function fingerprintOf(spec: PlateSpec): string {
  const sha = new Map(spec.models.map((model) => [model.id, model.sha256]))
  const body = {
    v: 2,
    profiles: spec.profiles,
    overrides: spec.overrides,
    objects: spec.objects.map(({ name: _name, modelId, ...placement }) => ({
      model: sha.get(modelId),
      ...placement,
    })),
  }
  return createHash('sha256')
    .update(JSON.stringify(stable(body)))
    .digest('hex')
}

type Tx = Prisma.TransactionClient

/** Bytes as Prisma's `Bytes` column takes them, without copying when they're already plain. */
const asBytes = (bytes: Uint8Array): Uint8Array<ArrayBuffer> =>
  bytes.buffer instanceof ArrayBuffer
    ? (bytes as Uint8Array<ArrayBuffer>)
    : new Uint8Array(bytes)

/**
 * The plate as it stands, read inside the caller's transaction. Scalars only. Null while a profile
 * is missing or being resolved again, so no slice is current until it's back.
 */
export async function currentSpec(tx: Tx, requestId: string): Promise<PlateSpec | null> {
  const request = await tx.printRequest.findUnique({
    where: { id: requestId },
    select: {
      printerProfileId: true,
      processProfileId: true,
      filamentProfileId: true,
      overrides: true,
    },
  })
  const ids = [
    request?.printerProfileId,
    request?.processProfileId,
    request?.filamentProfileId,
  ]
  if (!request || ids.some((id) => !id)) return null
  const profiles = await tx.slicerProfile.findMany({
    where: { id: { in: ids as string[] }, state: SlicerJobState.READY },
    select: { id: true, sha256: true },
  })
  const ref = (id: string | null) => {
    const sha256 = profiles.find((profile) => profile.id === id)?.sha256
    return id && sha256 ? { id, sha256 } : null
  }
  const printer = ref(request.printerProfileId)
  const process = ref(request.processProfileId)
  const filament = ref(request.filamentProfileId)
  if (!printer || !process || !filament) return null
  // Only models with a copy on the plate: one kept for undo slices nothing.
  const models = await tx.printModel.findMany({
    where: { requestId, objects: { some: {} } },
    orderBy: { position: 'asc' },
    select: { id: true, sha256: true, fileName: true },
  })
  const objects = await tx.printObject.findMany({
    where: { requestId },
    orderBy: { position: 'asc' },
    select: {
      modelId: true,
      name: true,
      x: true,
      y: true,
      qx: true,
      qy: true,
      qz: true,
      qw: true,
      sx: true,
      sy: true,
      sz: true,
    },
  })
  const parsed = plateSpec.safeParse({
    profiles: { printer, process, filament },
    overrides: (request.overrides ?? {}) as ProcessOverrides,
    objects,
    models,
  })
  return parsed.success ? parsed.data : null
}

// ------------------------------------------------------------------ worker

export interface ClaimedSlice {
  id: string
  requestId: string
  fingerprint: string
  spec: PlateSpec
  leaseToken: string
  attempts: number
}

/** Expired leases past their last attempt fail here rather than being handed out again. */
async function failAbandoned(): Promise<void> {
  await prisma.printSlice.updateMany({
    where: {
      state: SlicerJobState.RUNNING,
      leaseExpiresAt: { lt: new Date() },
      attempts: { gte: MAX_ATTEMPTS },
    },
    data: {
      state: SlicerJobState.FAILED,
      failure:
        'The slicer stopped twice on this plate. Try changing it, or ask an officer.',
      retryable: true,
      leaseToken: null,
      leaseExpiresAt: null,
      finishedAt: new Date(),
    },
  })
  await prisma.printModel.updateMany({
    where: {
      meshState: SlicerJobState.RUNNING,
      leaseExpiresAt: { lt: new Date() },
      attempts: { gte: MAX_ATTEMPTS },
    },
    data: {
      meshState: SlicerJobState.FAILED,
      meshFailure:
        "This STEP file couldn't be converted. Export it as STL and upload that.",
      leaseToken: null,
      leaseExpiresAt: null,
    },
  })
}

export async function claimSlice(): Promise<ClaimedSlice | null> {
  await failAbandoned()
  const token = randomUUID()
  const rows = await prisma.$queryRaw<
    {
      id: string
      request_id: string
      fingerprint: string
      spec: unknown
      attempts: number
    }[]
  >`
    UPDATE print_slices
    SET state = 'RUNNING', lease_token = ${token},
        lease_expires_at = now() + make_interval(secs => ${LEASE_SECONDS}),
        attempts = attempts + 1, started_at = now(), updated_at = now()
    WHERE id = (
      SELECT id FROM print_slices
      WHERE state = 'QUEUED' OR (state = 'RUNNING' AND lease_expires_at < now())
      ORDER BY requested_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, request_id, fingerprint, spec, attempts`
  const row = rows[0]
  if (!row) return null

  const spec = plateSpec.safeParse(row.spec)
  if (!spec.success) {
    await failSlice(
      row.id,
      token,
      'This plate was saved in a form the slicer no longer reads.',
      true,
    )
    return null
  }
  return {
    id: row.id,
    requestId: row.request_id,
    fingerprint: row.fingerprint,
    spec: spec.data,
    leaseToken: token,
    attempts: row.attempts,
  }
}

export interface ClaimedMesh {
  id: string
  fileId: string
  fileName: string
  leaseToken: string
}

export async function claimMesh(): Promise<ClaimedMesh | null> {
  const token = randomUUID()
  const rows = await prisma.$queryRaw<
    { id: string; file_id: string | null; file_name: string }[]
  >`
    UPDATE print_models
    SET mesh_state = 'RUNNING', lease_token = ${token},
        lease_expires_at = now() + make_interval(secs => ${LEASE_SECONDS}),
        attempts = attempts + 1
    WHERE id = (
      SELECT id FROM print_models
      WHERE mesh_state = 'QUEUED' OR (mesh_state = 'RUNNING' AND lease_expires_at < now())
      ORDER BY requested_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, file_id, file_name`
  const row = rows[0]
  if (!row) return null
  if (!row.file_id) {
    await failMesh(row.id, token, 'The upload was removed before it could be converted.')
    return null
  }
  return { id: row.id, fileId: row.file_id, fileName: row.file_name, leaseToken: token }
}

/** Pushes the lease out; false when the job was taken away, which means stop. */
export async function renewSlice(id: string, token: string): Promise<boolean> {
  const { count } = await prisma.printSlice.updateMany({
    where: { id, leaseToken: token, state: SlicerJobState.RUNNING },
    data: { leaseExpiresAt: new Date(Date.now() + LEASE_SECONDS * 1000) },
  })
  return count === 1
}

export async function renewMesh(id: string, token: string): Promise<boolean> {
  const { count } = await prisma.printModel.updateMany({
    where: { id, leaseToken: token, meshState: SlicerJobState.RUNNING },
    data: { leaseExpiresAt: new Date(Date.now() + LEASE_SECONDS * 1000) },
  })
  return count === 1
}

export async function failSlice(
  id: string,
  token: string,
  failure: string,
  retryable: boolean,
): Promise<void> {
  await prisma.printSlice.updateMany({
    where: { id, leaseToken: token },
    data: {
      state: SlicerJobState.FAILED,
      failure,
      retryable,
      leaseToken: null,
      leaseExpiresAt: null,
      finishedAt: new Date(),
    },
  })
}

/** Back in the queue after a crash, unless it has had its attempts. */
export async function retrySlice(
  id: string,
  token: string,
  attempts: number,
): Promise<void> {
  if (attempts >= MAX_ATTEMPTS) {
    await failSlice(
      id,
      token,
      'The slicer crashed on this plate. Try again in a minute.',
      true,
    )
    return
  }
  await prisma.printSlice.updateMany({
    where: { id, leaseToken: token },
    data: { state: SlicerJobState.QUEUED, leaseToken: null, leaseExpiresAt: null },
  })
}

export interface SliceOutput {
  output: Uint8Array
  outputName: string
  preview: Uint8Array | null
  previewFailure: string | null
  layerCount: number | null
  grams: number
  seconds: number
  meters: number | null
  orcaVersion: string
}

/** Stores the `.3mf` and preview and marks the job READY, in one transaction, if it's still ours. */
export async function publishSlice(
  id: string,
  token: string,
  result: SliceOutput,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const held = await tx.printSlice.findFirst({
      where: { id, leaseToken: token, state: SlicerJobState.RUNNING },
      select: { id: true, outputFileId: true, previewFileId: true },
    })
    if (!held) return false

    const stale = [held.outputFileId, held.previewFileId].filter(
      (v): v is string => v !== null,
    )
    if (stale.length > 0) await tx.storedFile.deleteMany({ where: { id: { in: stale } } })

    const output = await tx.storedFile.create({
      data: {
        kind: FileKind.PRINT_SLICE,
        mimeType: 'model/3mf',
        byteSize: result.output.byteLength,
        originalName: result.outputName,
        data: asBytes(result.output),
      },
      select: { id: true },
    })
    const preview = result.preview
      ? await tx.storedFile.create({
          data: {
            kind: FileKind.PRINT_PREVIEW,
            mimeType: 'application/octet-stream',
            byteSize: result.preview.byteLength,
            originalName: 'preview.rcpv',
            data: asBytes(result.preview),
          },
          select: { id: true },
        })
      : null

    await tx.printSlice.update({
      where: { id },
      data: {
        state: SlicerJobState.READY,
        outputFileId: output.id,
        previewFileId: preview?.id ?? null,
        previewFailure: result.previewFailure,
        layerCount: result.layerCount,
        estimatedGrams: result.grams,
        estimatedSeconds: result.seconds,
        filamentMeters: result.meters,
        orcaVersion: result.orcaVersion,
        failure: null,
        retryable: false,
        leaseToken: null,
        leaseExpiresAt: null,
        finishedAt: new Date(),
      },
    })
    return true
  })
}

export async function failMesh(
  id: string,
  token: string,
  failure: string,
): Promise<void> {
  await prisma.printModel.updateMany({
    where: { id, leaseToken: token },
    data: {
      meshState: SlicerJobState.FAILED,
      meshFailure: failure,
      leaseToken: null,
      leaseExpiresAt: null,
    },
  })
}

export async function publishMesh(
  id: string,
  token: string,
  stl: Uint8Array,
  fileName: string,
  triangles: number,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const held = await tx.printModel.findFirst({
      where: { id, leaseToken: token, meshState: SlicerJobState.RUNNING },
      select: { id: true },
    })
    if (!held) return false
    const mesh = await tx.storedFile.create({
      data: {
        kind: FileKind.PRINT_MODEL,
        mimeType: 'model/stl',
        byteSize: stl.byteLength,
        originalName: fileName,
        data: asBytes(stl),
      },
      select: { id: true },
    })
    await tx.printModel.update({
      where: { id },
      data: {
        meshState: SlicerJobState.READY,
        meshFileId: mesh.id,
        triangles,
        meshFailure: null,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    })
    return true
  })
}

export async function heartbeat(id: string, orcaVersion: string) {
  await prisma.slicerWorker.upsert({
    where: { id },
    create: { id, orcaVersion, seenAt: new Date() },
    update: { orcaVersion, seenAt: new Date() },
  })
}

/** Whether a worker has been seen recently enough to take a job. */
export async function workerOnline(): Promise<boolean> {
  const worker = await prisma.slicerWorker.findFirst({
    where: {
      seenAt: { gte: new Date(Date.now() - WORKER_FRESH_SECONDS * 1000) },
    },
    select: { id: true },
  })
  return worker !== null
}
