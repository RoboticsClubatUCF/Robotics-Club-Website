import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { prisma } from '../core/db.js'
import type { Prisma } from '../generated/prisma/client.js'
import { SlicerJobState, SlicerProfileKind } from '../generated/prisma/enums.js'
import type { FilamentInfo, PrinterInfo, ProcessInfo } from './profileResolve.js'

/**
 * The club's slicer profiles, as the API and the worker read them back out of `slicer_profiles`.
 *
 * Officers upload them on the profiles desk (`routes/officer/slicerProfiles.ts`) and the worker
 * resolves them (`profileResolve.ts`). A member sees only READY, offered ones; a plate names one
 * printer and one of that printer's processes and filaments, and every route that changes or
 * slices a plate checks that here.
 */

type Db = Prisma.TransactionClient

const exclude = z.object({ minX: z.number(), minY: z.number(), maxX: z.number(), maxY: z.number() })

export const printerInfo: z.ZodType<PrinterInfo> = z.object({
  model: z.string(),
  stockName: z.string(),
  nozzle: z.number(),
  bedType: z.string(),
  bed: z.object({
    width: z.number(),
    depth: z.number(),
    height: z.number(),
    exclude: exclude.nullable(),
  }),
  layerHeight: z.object({ min: z.number(), max: z.number() }),
})

export const processInfo: z.ZodType<ProcessInfo> = z.object({
  values: z.record(z.string(), z.union([z.number(), z.boolean(), z.string()])),
  summary: z.string(),
  compatiblePrinters: z.array(z.string()),
})

export const filamentInfo: z.ZodType<FilamentInfo> = z.object({
  type: z.string(),
  vendor: z.string(),
  compatiblePrinters: z.array(z.string()),
})

const profileSelect = {
  id: true,
  kind: true,
  name: true,
  label: true,
  description: true,
  offered: true,
  state: true,
  printerId: true,
  sha256: true,
  info: true,
} as const

type ProfileRow = Prisma.SlicerProfileGetPayload<{ select: typeof profileSelect }>

const order = [{ position: 'asc' }, { createdAt: 'asc' }] as const

/** What a member can pick from: printers with their processes, and filaments with the printer they're on. */
export async function workspaceProfiles(db: Db = prisma) {
  const rows = await db.slicerProfile.findMany({
    where: { state: SlicerJobState.READY, offered: true },
    orderBy: [...order],
    select: profileSelect,
  })

  const printers = rows.flatMap((row) => {
    if (row.kind !== SlicerProfileKind.PRINTER) return []
    const info = printerInfo.safeParse(row.info)
    if (!info.success) return []
    const processes = rows.flatMap((process) => {
      if (process.kind !== SlicerProfileKind.PROCESS || process.printerId !== row.id) return []
      const values = processInfo.safeParse(process.info)
      if (!values.success) return []
      return [
        {
          id: process.id,
          label: process.label,
          name: process.name,
          description: process.description ?? values.data.summary,
          values: values.data.values,
        },
      ]
    })
    // A printer with nothing to slice it with isn't a choice.
    if (processes.length === 0) return []
    return [
      {
        id: row.id,
        label: row.label,
        name: row.name,
        description: row.description,
        model: info.data.model,
        stockName: info.data.stockName,
        nozzle: info.data.nozzle,
        bedType: info.data.bedType,
        bed: info.data.bed,
        layerHeight: info.data.layerHeight,
        processes,
      },
    ]
  })

  const filaments = rows.flatMap((row) => {
    if (row.kind !== SlicerProfileKind.FILAMENT) return []
    const info = filamentInfo.safeParse(row.info)
    if (!info.success || !printers.some((printer) => printer.id === row.printerId)) return []
    return [
      {
        id: row.id,
        label: row.label,
        name: row.name,
        description: row.description,
        type: info.data.type,
        // A list, so the workspace reads it the way it did when one filament fit several.
        printers: [row.printerId!],
      },
    ]
  })

  return {
    printers: printers.map(({ stockName: _stockName, ...printer }) => printer),
    filaments,
  }
}

export type WorkspaceProfiles = Awaited<ReturnType<typeof workspaceProfiles>>

/** The three profiles a plate names. Any can be null: a profile an officer deleted. */
export interface PlateChoice {
  printerId: string | null
  processId: string | null
  filamentId: string | null
}

const refuse = (message: string) => new HTTPException(409, { message })

const NOUN = { PRINTER: 'printer', PROCESS: 'process', FILAMENT: 'filament' } as const

function usable(row: ProfileRow | undefined, kind: SlicerProfileKind, id: string | null) {
  const noun = NOUN[kind]
  if (!id) return refuse(`Pick a ${noun}.`)
  if (!row || row.kind !== kind) return refuse(`That ${noun} has been removed. Pick another.`)
  if (!row.offered) return refuse(`The ${row.label} ${noun} isn't offered any more. Pick another.`)
  if (row.state !== SlicerJobState.READY) {
    return refuse(`The ${row.label} ${noun} is being set up. Pick another, or try again in a minute.`)
  }
  return null
}

/**
 * Checks a plate's profiles and throws a 409 a member can act on. `changed` limits it to what an
 * edit touches, so a member can still change the process on a plate whose filament an officer has
 * since hidden; SLICE and SUBMIT check everything.
 */
export async function checkChoice(
  db: Db,
  choice: PlateChoice,
  changed: { printer: boolean; process: boolean; filament: boolean } = {
    printer: true,
    process: true,
    filament: true,
  },
) {
  const ids = [choice.printerId, choice.processId, choice.filamentId].filter(
    (id): id is string => id !== null,
  )
  const rows = await db.slicerProfile.findMany({
    where: { id: { in: ids } },
    select: profileSelect,
  })
  const byId = new Map(rows.map((row) => [row.id, row]))
  const printer = choice.printerId ? byId.get(choice.printerId) : undefined
  const process = choice.processId ? byId.get(choice.processId) : undefined
  const filament = choice.filamentId ? byId.get(choice.filamentId) : undefined

  const problem =
    (changed.printer && usable(printer, SlicerProfileKind.PRINTER, choice.printerId)) ||
    (changed.process && usable(process, SlicerProfileKind.PROCESS, choice.processId)) ||
    (changed.filament && usable(filament, SlicerProfileKind.FILAMENT, choice.filamentId))
  if (problem) throw problem

  if ((changed.printer || changed.process) && printer && process && process.printerId !== printer.id) {
    throw refuse(`The ${process.label} process is for another printer. Pick one of this printer's.`)
  }
  if ((changed.printer || changed.filament) && printer && filament && filament.printerId !== printer.id) {
    throw refuse(`That ${filament.label} is set up for another printer. Pick one of this printer's.`)
  }
  return { printer, process, filament }
}

/** The labels a plate is recorded under, keeping the old one for any profile that's gone. */
export async function choiceLabels(
  db: Db,
  choice: PlateChoice,
  previous: unknown,
): Promise<{ printer: string; process: string; filament: string }> {
  const old = slicedWith.safeParse(previous)
  const ids = [choice.printerId, choice.processId, choice.filamentId].filter(
    (id): id is string => id !== null,
  )
  const rows = await db.slicerProfile.findMany({
    where: { id: { in: ids } },
    select: { id: true, label: true },
  })
  const label = (id: string | null, fallback: string | undefined) =>
    rows.find((row) => row.id === id)?.label ?? fallback ?? ''
  return {
    printer: label(choice.printerId, old.data?.printer),
    process: label(choice.processId, old.data?.process),
    filament: label(choice.filamentId, old.data?.filament),
  }
}

/** `PrintRequest.slicedWith`. */
export const slicedWith = z.object({
  printer: z.string(),
  process: z.string(),
  filament: z.string(),
})

/** Which of a plate's profiles a member has to pick again, first one first, or null. */
export function missingChoice(
  profiles: WorkspaceProfiles,
  choice: PlateChoice,
): 'printer' | 'process' | 'filament' | null {
  const printer = profiles.printers.find((p) => p.id === choice.printerId)
  if (!printer) return 'printer'
  if (!printer.processes.some((p) => p.id === choice.processId)) return 'process'
  const fits = profiles.filaments.some(
    (f) => f.id === choice.filamentId && f.printers.includes(printer.id),
  )
  return fits ? null : 'filament'
}

/** Each of a plate's three profiles that's gone, hidden, or doesn't fit the plate's printer. */
export function missingKinds(profiles: WorkspaceProfiles, choice: PlateChoice) {
  const printer = profiles.printers.find((p) => p.id === choice.printerId)
  return {
    printer: !printer,
    process: !printer?.processes.some((p) => p.id === choice.processId),
    filament:
      !printer ||
      !profiles.filaments.some(
        (f) => f.id === choice.filamentId && f.printers.includes(printer.id),
      ),
  }
}

/** What a new plate starts with: the first offered printer, its first process, and the first filament that fits. */
export function defaultChoice(profiles: WorkspaceProfiles): PlateChoice | null {
  const printer = profiles.printers[0]
  const process = printer?.processes[0]
  const filament = profiles.filaments.find((f) => printer && f.printers.includes(printer.id))
  if (!printer || !process || !filament) return null
  return { printerId: printer.id, processId: process.id, filamentId: filament.id }
}

// ------------------------------------------------------------------ the worker's side

export interface LoadedProfile<Info> {
  id: string
  name: string
  text: string
  info: Info
}

export interface SliceProfiles {
  printer: LoadedProfile<PrinterInfo>
  process: LoadedProfile<ProcessInfo>
  filament: LoadedProfile<FilamentInfo>
}

/**
 * The three profiles a slice job names, exactly as they were when SLICE was pressed: READY,
 * resolved by this Orca, and with the hashes the job carries. Null when any has changed since.
 */
export async function loadSliceProfiles(
  refs: Record<'printer' | 'process' | 'filament', { id: string; sha256: string }>,
  orcaVersion: string,
): Promise<SliceProfiles | null> {
  const rows = await prisma.slicerProfile.findMany({
    where: { id: { in: [refs.printer.id, refs.process.id, refs.filament.id] } },
    select: { id: true, name: true, state: true, sha256: true, resolved: true, info: true, orcaVersion: true },
  })
  const load = <Info>(ref: { id: string; sha256: string }, schema: z.ZodType<Info>) => {
    const row = rows.find((r) => r.id === ref.id)
    if (
      !row ||
      row.state !== SlicerJobState.READY ||
      row.sha256 !== ref.sha256 ||
      row.orcaVersion !== orcaVersion ||
      row.resolved === null
    ) {
      return null
    }
    const info = schema.safeParse(row.info)
    return info.success ? { id: row.id, name: row.name, text: row.resolved, info: info.data } : null
  }
  const printer = load(refs.printer, printerInfo)
  const process = load(refs.process, processInfo)
  const filament = load(refs.filament, filamentInfo)
  return printer && process && filament ? { printer, process, filament } : null
}
