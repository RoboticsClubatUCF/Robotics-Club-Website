import { randomUUID } from 'node:crypto'
import { prisma } from '../core/db.js'
import { Prisma } from '../generated/prisma/client.js'
import { SlicerJobState, SlicerProfileKind } from '../generated/prisma/enums.js'
import { LEASE_SECONDS, MAX_ATTEMPTS } from './sliceJobs.js'

/**
 * The worker's third queue: officers' uploads waiting to be resolved (`slicer_profiles`).
 *
 * Claimed and leased the way slices and meshes are (`sliceJobs.ts`). A printer goes before its
 * processes and filaments, which are checked against it and processes take its plate type, and
 * processes before filaments, which are test-sliced on their printer's first process.
 */

export interface ClaimedProfile {
  id: string
  kind: SlicerProfileKind
  name: string
  label: string
  source: string
  printerId: string | null
  leaseToken: string
}

const ABANDONED = 'The slicer stopped twice on this profile. Upload it again, or check it in desktop Orca.'
const NO_PRINTER = `Its printer couldn't be set up. Fix or replace the printer first.`

async function failAbandoned(): Promise<void> {
  await prisma.slicerProfile.updateMany({
    where: {
      state: SlicerJobState.RUNNING,
      leaseExpiresAt: { lt: new Date() },
      attempts: { gte: MAX_ATTEMPTS },
    },
    data: {
      state: SlicerJobState.FAILED,
      failure: ABANDONED,
      leaseToken: null,
      leaseExpiresAt: null,
    },
  })
}

export async function claimProfile(): Promise<ClaimedProfile | null> {
  await failAbandoned()
  const token = randomUUID()
  // A process or filament waits for its printer, and fails with it (`failProfile`).
  const rows = await prisma.$queryRaw<
    {
      id: string
      kind: SlicerProfileKind
      name: string
      label: string
      source: string
      printer_id: string | null
    }[]
  >`
    UPDATE slicer_profiles
    SET state = 'RUNNING', lease_token = ${token},
        lease_expires_at = now() + make_interval(secs => ${LEASE_SECONDS}),
        attempts = attempts + 1, updated_at = now()
    WHERE id = (
      SELECT p.id FROM slicer_profiles p
      LEFT JOIN slicer_profiles printer ON printer.id = p.printer_id
      WHERE (p.state = 'QUEUED' OR (p.state = 'RUNNING' AND p.lease_expires_at < now()))
        AND (p.kind = 'PRINTER' OR printer.state = 'READY')
      ORDER BY CASE p.kind WHEN 'PRINTER' THEN 0 WHEN 'PROCESS' THEN 1 ELSE 2 END, p.requested_at
      FOR UPDATE OF p SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, kind, name, label, source, printer_id`
  const row = rows[0]
  if (!row) return null
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    label: row.label,
    source: row.source,
    printerId: row.printer_id,
    leaseToken: token,
  }
}

export async function renewProfile(id: string, token: string): Promise<boolean> {
  const { count } = await prisma.slicerProfile.updateMany({
    where: { id, leaseToken: token, state: SlicerJobState.RUNNING },
    data: { leaseExpiresAt: new Date(Date.now() + LEASE_SECONDS * 1000) },
  })
  return count === 1
}

/** Refused, in a sentence for the officer. A printer takes its waiting processes and filaments down with it. */
export async function failProfile(
  id: string,
  token: string,
  failure: string,
  orcaVersion: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.slicerProfile.updateMany({
      where: { id, leaseToken: token },
      data: {
        state: SlicerJobState.FAILED,
        failure,
        orcaVersion,
        resolved: null,
        sha256: null,
        info: Prisma.DbNull,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    })
    if (count === 0) return
    await tx.slicerProfile.updateMany({
      where: {
        printerId: id,
        state: { in: [SlicerJobState.QUEUED, SlicerJobState.RUNNING] },
      },
      data: {
        state: SlicerJobState.FAILED,
        failure: NO_PRINTER,
        orcaVersion,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    })
  })
}

export interface ResolvedProfile {
  resolved: string
  sha256: string
  info: Prisma.InputJsonValue
  orcaVersion: string
}

export async function publishProfile(
  id: string,
  token: string,
  result: ResolvedProfile,
): Promise<boolean> {
  const { count } = await prisma.slicerProfile.updateMany({
    where: { id, leaseToken: token, state: SlicerJobState.RUNNING },
    data: {
      state: SlicerJobState.READY,
      failure: null,
      resolved: result.resolved,
      sha256: result.sha256,
      info: result.info,
      orcaVersion: result.orcaVersion,
      leaseToken: null,
      leaseExpiresAt: null,
    },
  })
  return count === 1
}

/**
 * A profile is resolved against one Orca's stock profiles. A worker running another queues every
 * profile resolved or refused by a different one, so nothing slices on a stale flattening.
 */
export async function requeueOtherVersions(orcaVersion: string): Promise<number> {
  const { count } = await prisma.slicerProfile.updateMany({
    where: {
      state: { in: [SlicerJobState.READY, SlicerJobState.FAILED] },
      orcaVersion: { not: orcaVersion },
    },
    data: {
      state: SlicerJobState.QUEUED,
      attempts: 0,
      requestedAt: new Date(),
      leaseToken: null,
      leaseExpiresAt: null,
    },
  })
  return count
}

const ready = { state: SlicerJobState.READY } as const
const partner = { id: true, name: true, label: true, resolved: true, info: true } as const
// Offered ones first: a hidden profile is usually one on its way out.
const partnerOrder = [{ offered: 'desc' }, { position: 'asc' }, { createdAt: 'asc' }] as const

/** A printer's first READY process or filament, to test the other kind with. */
export async function firstReady(kind: 'PROCESS' | 'FILAMENT', printerId: string) {
  return prisma.slicerProfile.findFirst({
    where: { kind: SlicerProfileKind[kind], printerId, ...ready },
    orderBy: [...partnerOrder],
    select: partner,
  })
}

/** A printer's processes resolved before it had a filament to test them with. */
export async function untestedProcesses(printerId: string) {
  return prisma.slicerProfile.findMany({
    where: {
      kind: SlicerProfileKind.PROCESS,
      state: SlicerJobState.READY,
      printerId,
      info: { path: ['tested'], equals: false },
    },
    select: { id: true, name: true, label: true, printerId: true, resolved: true, info: true },
  })
}
