import { randomUUID } from 'node:crypto'
import type { z } from 'zod'
import { prisma } from '../core/db.js'
import type { Prisma } from '../generated/prisma/client.js'
import { SlicerJobState, SlicerProfileKind } from '../generated/prisma/enums.js'
import type { OrcaRunner } from './orcaRunner.js'
import {
  type ClaimedProfile,
  readyFilaments,
  readyPrinters,
  untestedProcesses,
} from './profileJobs.js'
import {
  type PrinterInfo,
  ProfileError,
  type StockProfiles,
  fitsPrinter,
  resolvePreset,
  sha256,
} from './profileResolve.js'
import {
  type LoadedProfile,
  type SliceProfiles,
  filamentInfo,
  printerInfo,
  processInfo,
} from './profiles.js'
import type { ClaimedSlice } from './sliceJobs.js'

/**
 * What the worker does with an uploaded profile: flatten it, then slice a test cube with it if the
 * club has the other two profiles it needs. Orca loads nearly anything and only complains when it
 * slices: a 5 mm layer height crashes it there. So the test is what catches a bad export before a
 * member does.
 *
 * A process can't be tested before some filament fits its printer, and a filament needs a printer
 * with a process. Whichever comes first is marked untested, and the first filament that fits tests
 * the processes left waiting.
 */

/** A 20 mm cube, as triangle positions. */
function cube(size = 20): Float32Array {
  const v = [
    [0, 0, 0],
    [size, 0, 0],
    [size, size, 0],
    [0, size, 0],
    [0, 0, size],
    [size, 0, size],
    [size, size, size],
    [0, size, size],
  ]
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

const ref = (profile: LoadedProfile<unknown>) => ({ id: profile.id, sha256: sha256(profile.text) })

/** Slices the cube in the middle of the bed. Null when Orca managed it, or why it didn't. */
export async function testSlice(
  runner: OrcaRunner,
  profiles: SliceProfiles,
  deadline: number,
  signal?: AbortSignal,
): Promise<string | null> {
  const bed = profiles.printer.info.bed
  const job: ClaimedSlice = {
    id: `profile-test-${randomUUID()}`,
    requestId: 'profile-test',
    fingerprint: 'profile-test',
    leaseToken: randomUUID(),
    attempts: 1,
    spec: {
      profiles: {
        printer: ref(profiles.printer),
        process: ref(profiles.process),
        filament: ref(profiles.filament),
      },
      overrides: {},
      models: [{ id: 'cube', sha256: 'cube', fileName: 'cube.stl' }],
      objects: [
        {
          modelId: 'cube',
          name: 'Test cube',
          x: bed.width / 2,
          y: bed.depth / 2,
          qx: 0,
          qy: 0,
          qz: 0,
          qw: 1,
          sx: 1,
          sy: 1,
          sz: 1,
        },
      ],
    },
  }
  const result = await runner.slice(job, profiles, new Map([['cube', cube()]]), deadline, signal)
  if (!('failure' in result)) return null
  if (result.detail) console.warn(`slicer: profile test: ${result.detail}`)
  const said = result.orca && result.orca !== 'Success.' ? ` Orca said: ${result.orca}` : ''
  return result.transient
    ? `Orca crashed slicing a test cube with it. Open it in desktop Orca and check its settings.${said}`
    : `Orca couldn't slice a test cube with it.${said}`
}

type Partner = { id: string; name: string; label: string; resolved: string | null; info: Prisma.JsonValue }

function loaded<Info>(row: Partner, schema: z.ZodType<Info>): LoadedProfile<Info> | null {
  const info = schema.safeParse(row.info)
  return info.success && row.resolved !== null
    ? { id: row.id, name: row.name, text: row.resolved, info: info.data }
    : null
}

export type ProfileOutcome =
  | { failure: string }
  | { resolved: string; sha256: string; info: Prisma.InputJsonValue }

/** Resolves and tests one claimed profile. Throws only on a fault of the worker's own. */
export async function resolveProfile(
  job: ClaimedProfile,
  stock: StockProfiles,
  runner: OrcaRunner,
  deadline: number,
  signal?: AbortSignal,
): Promise<ProfileOutcome> {
  let printer: { row: Partner; profile: LoadedProfile<PrinterInfo> } | null = null
  if (job.kind === SlicerProfileKind.PROCESS) {
    const row = await prisma.slicerProfile.findFirst({
      where: { id: job.printerId ?? '', state: SlicerJobState.READY },
      select: { id: true, name: true, label: true, resolved: true, info: true },
    })
    const profile = row ? loaded(row, printerInfo) : null
    if (!row || !profile) {
      return { failure: `Its printer couldn't be set up. Fix or replace the printer first.` }
    }
    printer = { row, profile }
  }

  let resolved
  try {
    resolved = await resolvePreset(
      job.source,
      job.kind,
      stock,
      printer ? { name: printer.row.name, info: printer.profile.info } : undefined,
    )
  } catch (error) {
    if (error instanceof ProfileError) return { failure: error.message }
    throw error
  }
  const self = { id: job.id, name: job.name, text: resolved.text }

  let testedWith: string | null = null

  if (resolved.kind === 'PROCESS' && printer) {
    const { row: printerRow, profile: machine } = printer
    const stockName = { name: printerRow.name, stockName: machine.info.stockName }
    const filament = (await readyFilaments())
      .map((row) => ({ row, profile: loaded(row, filamentInfo) }))
      .find(({ profile }) => profile && fitsPrinter(profile.info.compatiblePrinters, stockName))
    if (filament?.profile) {
      const failure = await testSlice(
        runner,
        { printer: machine, process: { ...self, info: resolved.info }, filament: filament.profile },
        deadline,
        signal,
      )
      if (failure) {
        return { failure: `${failure} (tested on ${printerRow.label} with ${filament.row.label})` }
      }
      testedWith = `${printerRow.label}, ${filament.row.label}`
    }
  }

  if (resolved.kind === 'FILAMENT') {
    const filament = { ...self, info: resolved.info }
    const fits = (await readyPrinters()).flatMap((row) => {
      const profile = loaded(row, printerInfo)
      return profile &&
        fitsPrinter(resolved.info.compatiblePrinters, { name: row.name, stockName: profile.info.stockName })
        ? [{ row, profile }]
        : []
    })
    const first = fits.find(({ row }) => row.processes.length > 0)
    const process = first?.row.processes[0] ? loaded(first.row.processes[0], processInfo) : null
    if (first && process) {
      const failure = await testSlice(runner, { printer: first.profile, process, filament }, deadline, signal)
      if (failure) {
        return { failure: `${failure} (tested on ${first.row.label} with ${first.row.processes[0]!.label})` }
      }
      testedWith = `${first.row.label}, ${first.row.processes[0]!.label}`
    }
    // The processes nothing could test until now.
    for (const row of await untestedProcesses(fits.map(({ row }) => row.id))) {
      const owner = fits.find(({ row: printerRow }) => printerRow.id === row.printerId)
      const waiting = loaded(row, processInfo)
      if (!owner || !waiting || signal?.aborted) continue
      const failure = await testSlice(runner, { printer: owner.profile, process: waiting, filament }, deadline, signal)
      await markTested(row.id, row.resolved, failure, `${owner.row.label}, ${job.label}`)
    }
  }

  const info = { ...resolved.info, tested: testedWith !== null, testedWith }
  return { resolved: resolved.text, sha256: sha256(resolved.text), info }
}

/** Records a waiting process's test, unless it has been replaced in the meantime. */
async function markTested(
  id: string,
  text: string | null,
  failure: string | null,
  testedWith: string,
): Promise<void> {
  const row = await prisma.slicerProfile.findFirst({
    where: { id, state: SlicerJobState.READY, resolved: text },
    select: { info: true },
  })
  if (!row) return
  if (failure) {
    await prisma.slicerProfile.updateMany({
      where: { id, state: SlicerJobState.READY, resolved: text },
      data: { state: SlicerJobState.FAILED, failure: `${failure} (tested on ${testedWith})` },
    })
    return
  }
  await prisma.slicerProfile.updateMany({
    where: { id, state: SlicerJobState.READY, resolved: text },
    data: { info: { ...(row.info as Record<string, Prisma.InputJsonValue>), tested: true, testedWith } },
  })
}
