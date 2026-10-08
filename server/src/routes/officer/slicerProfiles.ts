import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { requireOfficer } from '../../auth/authz.js'
import { type AuthEnv, originGuard, requireAuth } from '../../auth/session.js'
import { prisma } from '../../core/db.js'
import { rateLimit } from '../../core/rateLimit.js'
import { validate } from '../../core/validate.js'
import { Prisma } from '../../generated/prisma/client.js'
import {
  PrintRequestStatus,
  SlicerJobState,
  SlicerProfileKind,
} from '../../generated/prisma/enums.js'
import { ProfileError, type UploadedPreset, fitsPrinter, readPresetFile } from '../../printing/profileResolve.js'
import { filamentInfo, printerInfo } from '../../printing/profiles.js'
import { workerOnline } from '../../printing/sliceJobs.js'

/**
 * The slicer profiles desk: the printers, processes and filaments members slice with.
 *
 *   GET    /api/officer/slicer-profiles              -> every profile, its state and what uses it
 *   POST   /api/officer/slicer-profiles/inspect      -> the presets in an export, saving nothing
 *   POST   /api/officer/slicer-profiles              -> add presets from an export
 *   PATCH  /api/officer/slicer-profiles/order        -> reorder one list
 *   PATCH  /api/officer/slicer-profiles/:id          -> label, description, offered
 *   POST   /api/officer/slicer-profiles/:id/replace  -> a newer export of the same preset
 *   DELETE /api/officer/slicer-profiles/:id          -> remove it, and a printer's processes
 *
 * Officers upload what desktop Orca exports (`.orca_printer`, `.orca_filament`, a zip of presets
 * or one `.json`) and pick which presets in it to add. The API only reads the file; the worker
 * flattens each preset against Orca's stock profiles and test-slices it, so a new row is QUEUED
 * and the desk polls until it's READY or FAILED.
 *
 * Deleting is allowed while drafts use a profile. Their columns go null and the workspace asks the
 * member to pick again; a request already sent keeps its `.3mf` and its labels.
 */
export const slicerProfiles = new Hono<AuthEnv>()

const writes = rateLimit('officer', 60)
const uploads = rateLimit('profiles', 30)

/** Room for a few printers, their processes and a shelf of filaments, and no runaway. */
export const MAX_PROFILES = 100

const uploadLimit = bodyLimit({
  maxSize: 5 * 1024 * 1024,
  onError: () => {
    throw new HTTPException(413, { message: `That file is too big for an Orca export.` })
  },
})

const NOUN = { PRINTER: 'printer', PROCESS: 'process', FILAMENT: 'filament' } as const

const select = {
  id: true,
  kind: true,
  name: true,
  label: true,
  description: true,
  offered: true,
  position: true,
  printerId: true,
  sourceFile: true,
  state: true,
  failure: true,
  info: true,
  orcaVersion: true,
  updatedAt: true,
  uploadedBy: { select: { fullName: true } },
} as const

type Row = Prisma.SlicerProfileGetPayload<{ select: typeof select }>

const LIVE = [PrintRequestStatus.DRAFT, PrintRequestStatus.PENDING, PrintRequestStatus.PRINTING]

/** How many drafts and unsettled requests name each profile, for the delete warning. */
async function usage() {
  const counts = new Map<string, { drafts: number; sent: number }>()
  const count = async (column: 'printerProfileId' | 'processProfileId' | 'filamentProfileId') => {
    const groups = await prisma.printRequest.groupBy({
      by: [column, 'status'],
      where: { status: { in: LIVE }, [column]: { not: null } },
      _count: { _all: true },
    })
    for (const group of groups) {
      const id = group[column]
      if (!id) continue
      const entry = counts.get(id) ?? { drafts: 0, sent: 0 }
      if (group.status === PrintRequestStatus.DRAFT) entry.drafts += group._count._all
      else entry.sent += group._count._all
      counts.set(id, entry)
    }
  }
  await count('printerProfileId')
  await count('processProfileId')
  await count('filamentProfileId')
  return counts
}

const order = [{ position: 'asc' }, { createdAt: 'asc' }] as const

/** The whole desk, in one shape the routes below all answer with. */
async function deskView() {
  const [rows, uses, online] = await Promise.all([
    prisma.slicerProfile.findMany({ orderBy: [...order], select }),
    usage(),
    workerOnline(),
  ])
  const view = (row: Row) => {
    const info = row.info as Record<string, unknown> | null
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      label: row.label,
      description: row.description,
      offered: row.offered,
      state: row.state,
      failure: row.failure,
      sourceFile: row.sourceFile,
      info: row.state === SlicerJobState.READY ? info : null,
      testedWith: typeof info?.['testedWith'] === 'string' ? info['testedWith'] : null,
      orcaVersion: row.orcaVersion,
      uploadedBy: row.uploadedBy?.fullName ?? null,
      updatedAt: row.updatedAt,
      uses: uses.get(row.id) ?? { drafts: 0, sent: 0 },
    }
  }
  const printerRows = rows.filter((row) => row.kind === SlicerProfileKind.PRINTER)
  const printers = printerRows.map((row) => ({
    ...view(row),
    processes: rows
      .filter((process) => process.kind === SlicerProfileKind.PROCESS && process.printerId === row.id)
      .map(view),
  }))
  const filaments = rows
    .filter((row) => row.kind === SlicerProfileKind.FILAMENT)
    .map((row) => {
      const fits = filamentInfo.safeParse(row.info)
      return {
        ...view(row),
        // Which printers it can go on, by the names it lists. Unknown until it's resolved.
        fits: fits.success
          ? printerRows
              .filter((printer) => {
                const stock = printerInfo.safeParse(printer.info)
                return fitsPrinter(fits.data.compatiblePrinters, {
                  name: printer.name,
                  stockName: stock.success ? stock.data.stockName : '',
                })
              })
              .map((printer) => printer.id)
          : null,
      }
    })
  return { printers, filaments, workerOnline: online, limit: MAX_PROFILES }
}

/** The uploaded file's presets, or a 400 saying what's wrong with it. */
async function readUpload(value: unknown): Promise<{ fileName: string; presets: UploadedPreset[] }> {
  if (!(value instanceof File) || value.size === 0) {
    throw new HTTPException(400, { message: 'Attach the exported file itself.' })
  }
  const fileName = value.name.slice(0, 200)
  try {
    return { fileName, presets: readPresetFile(fileName, new Uint8Array(await value.arrayBuffer())) }
  } catch (error) {
    if (error instanceof ProfileError) throw new HTTPException(400, { message: error.message })
    throw error
  }
}

const sourceFile = (fileName: string, preset: UploadedPreset) =>
  preset.entry === fileName ? fileName : `${fileName}: ${preset.entry}`

/** A multipart field holding JSON, or a 400. */
function jsonField<T>(value: unknown, schema: z.ZodType<T>, message: string): T {
  let parsed: unknown
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : undefined
  } catch {
    throw new HTTPException(400, { message })
  }
  const result = schema.safeParse(parsed)
  if (!result.success) throw new HTTPException(400, { message })
  return result.data
}

type Tx = Prisma.TransactionClient

/** One desk write at a time, so two officers can't both take a name. */
const lockDesk = (tx: Tx) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('slicer-profiles'))`

async function assertNameFree(
  tx: Tx,
  kind: SlicerProfileKind,
  name: string,
  printerId: string | null,
  except?: string,
) {
  const taken = await tx.slicerProfile.findFirst({
    where: {
      kind,
      name,
      ...(kind === SlicerProfileKind.PROCESS ? { printerId } : {}),
      ...(except ? { id: { not: except } } : {}),
    },
    select: { label: true },
  })
  if (taken) {
    throw new HTTPException(409, {
      message: `There's already a ${NOUN[kind]} called "${name}"${kind === SlicerProfileKind.PROCESS ? ' on that printer' : ''}. Replace that one instead.`,
    })
  }
}

async function nextPosition(tx: Tx, kind: SlicerProfileKind, printerId: string | null) {
  const { _max } = await tx.slicerProfile.aggregate({
    where: { kind, ...(kind === SlicerProfileKind.PROCESS ? { printerId } : {}) },
    _max: { position: true },
  })
  return (_max.position ?? -1) + 1
}

slicerProfiles.get('/', requireAuth, requireOfficer, async (c) => {
  c.header('Cache-Control', 'private, no-store')
  return c.json(await deskView())
})

slicerProfiles.post(
  '/inspect',
  originGuard,
  requireAuth,
  requireOfficer,
  uploadLimit,
  uploads,
  async (c) => {
    const body = await c.req.parseBody()
    const { fileName, presets } = await readUpload(body['file'])
    const existing = await prisma.slicerProfile.findMany({
      where: { name: { in: presets.map((preset) => preset.name) } },
      select: { id: true, kind: true, name: true, label: true, printerId: true },
    })
    // A bundle for a printer that's already here: its processes go on that printer, so they're
    // matched against its processes, and the desk offers it as where they go.
    const bundled = presets.find((preset) => preset.kind === 'PRINTER')
    const printer = bundled
      ? (existing.find((row) => row.kind === SlicerProfileKind.PRINTER && row.name === bundled.name) ?? null)
      : null
    const found = (preset: UploadedPreset) => {
      const row = existing.find(
        (candidate) =>
          candidate.kind === preset.kind &&
          candidate.name === preset.name &&
          (preset.kind !== 'PROCESS' || (printer !== null && candidate.printerId === printer.id)),
      )
      return row ? { id: row.id, label: row.label } : null
    }
    return c.json({
      fileName,
      printer: printer ? { id: printer.id, label: printer.label } : null,
      presets: presets.map((preset) => ({
        entry: preset.entry,
        kind: preset.kind,
        name: preset.name,
        inherits: preset.inherits,
        existing: found(preset),
      })),
    })
  },
)

slicerProfiles.post('/', originGuard, requireAuth, requireOfficer, uploadLimit, uploads, async (c) => {
  const user = c.get('user')
  const body = await c.req.parseBody()
  const { fileName, presets } = await readUpload(body['file'])
  const entries = jsonField(
    body['entries'],
    z.array(z.string().min(1).max(300)).min(1).max(50),
    'Pick at least one preset from the file.',
  )
  const printerField = typeof body['printerId'] === 'string' && body['printerId'] !== '' ? body['printerId'] : null

  const chosen = entries.map((entry) => {
    const preset = presets.find((p) => p.entry === entry)
    if (!preset) throw new HTTPException(400, { message: `The file has no ${entry}.` })
    return preset
  })
  if (new Set(entries).size !== entries.length) {
    throw new HTTPException(400, { message: 'A preset was picked twice.' })
  }
  const printers = chosen.filter((preset) => preset.kind === 'PRINTER')
  if (printers.length > 1) {
    throw new HTTPException(400, { message: 'Add one printer at a time, with its processes.' })
  }
  const processes = chosen.filter((preset) => preset.kind === 'PROCESS')
  if (processes.length > 0 && printers.length === 0 && !printerField) {
    throw new HTTPException(400, {
      message: `A process belongs to a printer. Pick the printer in this file too, or one that's already set up.`,
    })
  }
  for (const kind of ['PRINTER', 'PROCESS', 'FILAMENT'] as const) {
    const names = chosen.filter((preset) => preset.kind === kind).map((preset) => preset.name)
    if (new Set(names).size !== names.length) {
      throw new HTTPException(400, { message: `Two of the ${NOUN[kind]}s picked have the same name.` })
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    await lockDesk(tx)
    if ((await tx.slicerProfile.count()) + chosen.length > MAX_PROFILES) {
      throw new HTTPException(409, {
        message: `The slicer holds ${String(MAX_PROFILES)} profiles at most. Delete some first.`,
      })
    }

    const make = async (preset: UploadedPreset, printerId: string | null) => {
      const kind = preset.kind
      await assertNameFree(tx, kind, preset.name, printerId)
      return tx.slicerProfile.create({
        data: {
          kind,
          name: preset.name,
          label: preset.name.slice(0, 60),
          position: await nextPosition(tx, kind, printerId),
          printerId,
          source: preset.text,
          sourceFile: sourceFile(fileName, preset),
          uploadedById: user.id,
        },
        select: { id: true },
      })
    }

    const ids: string[] = []
    let printerId = printerField
    if (printers[0]) {
      const printer = await make(printers[0], null)
      printerId = printer.id
      ids.push(printer.id)
    } else if (printerId) {
      const printer = await tx.slicerProfile.findUnique({ where: { id: printerId }, select: { kind: true } })
      if (printer?.kind !== SlicerProfileKind.PRINTER) {
        throw new HTTPException(404, { message: 'That printer has been removed.' })
      }
    }
    for (const preset of processes) ids.push((await make(preset, printerId)).id)
    for (const preset of chosen.filter((p) => p.kind === 'FILAMENT')) ids.push((await make(preset, null)).id)
    return ids
  })

  return c.json({ created, ...(await deskView()) }, 201)
})

const reorder = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(MAX_PROFILES) })

slicerProfiles.patch(
  '/order',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate('json', reorder),
  async (c) => {
    const { ids } = c.req.valid('json')
    await prisma.$transaction(async (tx) => {
      await lockDesk(tx)
      const first = await tx.slicerProfile.findUnique({
        where: { id: ids[0]! },
        select: { kind: true, printerId: true },
      })
      if (!first) throw new HTTPException(404, { message: 'One of those profiles has been removed.' })
      // The whole list, so nothing is left at a position the order doesn't account for.
      const group = await tx.slicerProfile.findMany({
        where: {
          kind: first.kind,
          ...(first.kind === SlicerProfileKind.PROCESS ? { printerId: first.printerId } : {}),
        },
        select: { id: true },
      })
      const known = new Set(group.map((row) => row.id))
      if (group.length !== ids.length || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
        throw new HTTPException(409, { message: 'That list changed while you were sorting it. Reload and try again.' })
      }
      for (const [position, id] of ids.entries()) {
        await tx.slicerProfile.update({ where: { id }, data: { position } })
      }
    })
    return c.json(await deskView())
  },
)

const edit = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  description: z.string().trim().max(200).nullable().optional(),
  offered: z.boolean().optional(),
})

slicerProfiles.patch(
  '/:id',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate('json', edit),
  async (c) => {
    const { label, description, offered } = c.req.valid('json')
    const { count } = await prisma.slicerProfile.updateMany({
      where: { id: c.req.param('id') },
      data: {
        ...(label === undefined ? {} : { label }),
        ...(description === undefined ? {} : { description: description || null }),
        ...(offered === undefined ? {} : { offered }),
      },
    })
    if (count === 0) throw new HTTPException(404, { message: 'That profile has been removed.' })
    return c.json(await deskView())
  },
)

slicerProfiles.post(
  '/:id/replace',
  originGuard,
  requireAuth,
  requireOfficer,
  uploadLimit,
  uploads,
  async (c) => {
    const user = c.get('user')
    const body = await c.req.parseBody()
    const { fileName, presets } = await readUpload(body['file'])
    const entry = typeof body['entry'] === 'string' && body['entry'] !== '' ? body['entry'] : null

    await prisma.$transaction(async (tx) => {
      await lockDesk(tx)
      const profile = await tx.slicerProfile.findUnique({
        where: { id: c.req.param('id') },
        select: { id: true, kind: true, printerId: true },
      })
      if (!profile) throw new HTTPException(404, { message: 'That profile has been removed.' })

      const same = presets.filter((preset) => preset.kind === profile.kind)
      const preset = entry ? same.find((p) => p.entry === entry) : same.length === 1 ? same[0] : undefined
      if (!preset) {
        throw new HTTPException(400, {
          message:
            same.length === 0
              ? `That file has no ${NOUN[profile.kind]} in it.`
              : `That file has more than one ${NOUN[profile.kind]}. Pick which.`,
        })
      }
      await assertNameFree(tx, profile.kind, preset.name, profile.printerId, profile.id)

      const queued = {
        state: SlicerJobState.QUEUED,
        failure: null,
        resolved: null,
        sha256: null,
        info: Prisma.DbNull,
        attempts: 0,
        leaseToken: null,
        leaseExpiresAt: null,
        requestedAt: new Date(),
      }
      await tx.slicerProfile.update({
        where: { id: profile.id },
        data: {
          ...queued,
          name: preset.name,
          source: preset.text,
          sourceFile: sourceFile(fileName, preset),
          uploadedById: user.id,
        },
      })
      // A process takes its plate type from its printer, so it's resolved again with it.
      if (profile.kind === SlicerProfileKind.PRINTER) {
        await tx.slicerProfile.updateMany({ where: { printerId: profile.id }, data: queued })
      }
    })
    return c.json(await deskView())
  },
)

slicerProfiles.delete('/:id', originGuard, requireAuth, requireOfficer, writes, async (c) => {
  const { count } = await prisma.slicerProfile.deleteMany({ where: { id: c.req.param('id') } })
  if (count === 0) throw new HTTPException(404, { message: 'That profile has been removed.' })
  return c.json(await deskView())
})
