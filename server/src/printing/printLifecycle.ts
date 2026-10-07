import { prisma } from '../core/db.js'
import { env } from '../core/env.js'
import type { Prisma } from '../generated/prisma/client.js'
import { FileKind, PrintRequestStatus } from '../generated/prisma/enums.js'

/**
 * Which bytes a print request holds, and the one place they're deleted.
 *
 * A request can hold a resin upload, a filament plate's models and their STEP meshes, and the
 * plate's `.3mf` and preview. All of it goes in the same transaction that settles, withdraws,
 * discards or expires the request, so a settled print never leaves a file behind that nothing
 * points at. The request row stays as the record wherever the request itself does.
 */

type Tx = Prisma.TransactionClient

/** Every stored file the given requests point at. Scalars only, safe inside a transaction. */
export async function heldFileIds(tx: Tx, requestIds: string[]): Promise<string[]> {
  if (requestIds.length === 0) return []
  const [requests, models, slices] = [
    await tx.printRequest.findMany({
      where: { id: { in: requestIds } },
      select: { fileId: true },
    }),
    await tx.printModel.findMany({
      where: { requestId: { in: requestIds } },
      select: { fileId: true, meshFileId: true },
    }),
    await tx.printSlice.findMany({
      where: { requestId: { in: requestIds } },
      select: { outputFileId: true, previewFileId: true },
    }),
  ]
  return [
    ...requests.map((row) => row.fileId),
    ...models.flatMap((row) => [row.fileId, row.meshFileId]),
    ...slices.flatMap((row) => [row.outputFileId, row.previewFileId]),
  ].filter((id): id is string => id !== null)
}

/** Deletes every file the requests hold. The rows' file columns go null under `SetNull`. */
export async function deleteHeldFiles(tx: Tx, requestIds: string[]): Promise<void> {
  const ids = await heldFileIds(tx, requestIds)
  if (ids.length > 0) await tx.storedFile.deleteMany({ where: { id: { in: ids } } })
}

/** Removes requests and everything they hold: a withdrawal, a discarded or expired draft. */
export async function deleteRequests(tx: Tx, requestIds: string[]): Promise<void> {
  await deleteHeldFiles(tx, requestIds)
  await tx.printRequest.deleteMany({ where: { id: { in: requestIds } } })
}

/** The files of models taken off a draft. */
export async function deleteModelFiles(tx: Tx, modelIds: string[]): Promise<void> {
  if (modelIds.length === 0) return
  const models = await tx.printModel.findMany({
    where: { id: { in: modelIds } },
    select: { fileId: true, meshFileId: true },
  })
  const ids = models
    .flatMap((row) => [row.fileId, row.meshFileId])
    .filter((id): id is string => id !== null)
  if (ids.length > 0) await tx.storedFile.deleteMany({ where: { id: { in: ids } } })
}

/** Bytes held by print files right now, against `PRINT_STORAGE_CAP_MB`. */
export async function printStorageBytes(): Promise<number> {
  const result = await prisma.storedFile.aggregate({
    where: { kind: { in: [FileKind.PRINT_MODEL, FileKind.PRINT_SLICE, FileKind.PRINT_PREVIEW] } },
    _sum: { byteSize: true },
  })
  return result._sum.byteSize ?? 0
}

export const storageCapBytes = () => env.PRINT_STORAGE_CAP_MB * 1024 * 1024

/** When a draft last touched expires. */
export function draftExpiry(draft: { createdAt: Date; draftActiveAt: Date | null }): Date {
  const idle = (draft.draftActiveAt ?? draft.createdAt).getTime() + env.PRINT_DRAFT_IDLE_HOURS * 3_600_000
  const oldest = draft.createdAt.getTime() + env.PRINT_DRAFT_MAX_DAYS * 86_400_000
  return new Date(Math.min(idle, oldest))
}

/**
 * Drafts nobody has touched for `PRINT_DRAFT_IDLE_HOURS`, or older than `PRINT_DRAFT_MAX_DAYS`,
 * go with their files. Runs on the API's ten-minute timer. `now` is a parameter so tests can
 * pin it far from any real draft.
 */
export async function sweepPrintDrafts(now: Date = new Date()): Promise<number> {
  const idleBefore = new Date(now.getTime() - env.PRINT_DRAFT_IDLE_HOURS * 3_600_000)
  const createdBefore = new Date(now.getTime() - env.PRINT_DRAFT_MAX_DAYS * 86_400_000)
  const expired = await prisma.printRequest.findMany({
    where: {
      status: PrintRequestStatus.DRAFT,
      OR: [
        { draftActiveAt: { lt: idleBefore } },
        { draftActiveAt: null, createdAt: { lt: idleBefore } },
        { createdAt: { lt: createdBefore } },
      ],
    },
    select: { id: true },
    take: 200,
  })
  if (expired.length === 0) return 0
  const ids = expired.map((row) => row.id)
  await prisma.$transaction(async (tx) => {
    // Re-checked inside: a draft submitted a moment ago isn't a draft any more.
    const still = await tx.printRequest.findMany({
      where: { id: { in: ids }, status: PrintRequestStatus.DRAFT },
      select: { id: true },
    })
    await deleteRequests(
      tx,
      still.map((row) => row.id),
    )
  })
  return expired.length
}
