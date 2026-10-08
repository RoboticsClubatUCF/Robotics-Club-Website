import { createHash } from 'node:crypto'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { isOfficer, requireDuesForRoute } from '../../auth/authz.js'
import { type AuthEnv, originGuard, requireAuth } from '../../auth/session.js'
import { prisma } from '../../core/db.js'
import { env } from '../../core/env.js'
import { consume, rateLimit } from '../../core/rateLimit.js'
import { validate } from '../../core/validate.js'
import { notifyOfficers } from '../../discord/officerNotify.js'
import { looksLikePrintModel } from '../../files/files.js'
import type { Prisma } from '../../generated/prisma/client.js'
import {
  FileKind,
  PrintPreset,
  PrintProcess,
  PrintRequestStatus,
  SlicerJobState,
} from '../../generated/prisma/enums.js'
import { currentTerm } from '../../membership/semester.js'
import { MAX_SCALE, MIN_SCALE, canonicalQuat } from '../../printing/plateTransform.js'
import {
  deleteModelFiles,
  deleteRequests,
  draftExpiry,
  printStorageBytes,
  storageCapBytes,
} from '../../printing/printLifecycle.js'
import { MATERIAL_LABEL } from '../../printing/printSettings.js'
import { processOverrides } from '../../printing/processSettings.js'
import { sliceManifest, workspaceProfiles } from '../../printing/profiles.js'
import { currentSpec, fingerprintOf, workerOnline } from '../../printing/sliceJobs.js'
import { MeshError, parseStl } from '../../printing/stl.js'
import { printSelect } from './print.js'

/**
 * Filament plates, prepared and sliced by their owner.
 *
 *   GET    /api/print/workspace             -> presets, bed, limits, whether the slicer is up
 *   GET    /api/print/drafts                -> my drafts
 *   POST   /api/print/drafts                -> first upload: a new draft with one object
 *   GET    /api/print/drafts/:id            -> the plate, its settings and its slice
 *   POST   /api/print/drafts/:id/models     -> add a model and one copy of it
 *   PATCH  /api/print/drafts/:id            -> settings and the whole object list
 *   POST   /api/print/drafts/:id/slice      -> queue it for the slicer worker
 *   GET    /api/print/drafts/:id/preview    -> the sliced plate's layer preview
 *   POST   /api/print/drafts/:id/submit     -> send it to the officers' queue
 *   DELETE /api/print/drafts/:id            -> discard it
 *   POST   /api/print/:id/unsubmit          -> take a waiting plate back to edit
 *   GET    /api/print/models/:id/mesh       -> a model's mesh, for the workspace
 *
 * A draft is a `PrintRequest` in DRAFT: private, charging nothing, expiring on its own. Every
 * edit, SLICE and SUBMIT names the revision it saw, so a stale tab gets a 409 rather than
 * overwriting newer work. A slice is current while its fingerprint matches the plate; SUBMIT
 * refuses anything else, so what an officer downloads is what the member last saw.
 *
 * The per-member limits are checked under that member's advisory lock, so two tabs can't both
 * slip under one.
 */
export const printDrafts = new Hono<AuthEnv>()

/** Autosave fires on every finished drag, so edits get a budget that working never meets. */
const edits = rateLimit('printDraft', 600)
const uploads = rateLimit('printUpload', 30)
const submissions = rateLimit('print', 5)

const uploadLimit = bodyLimit({
  maxSize: env.MAX_PRINT_FILE_MB * 1024 * 1024 + 64 * 1024,
  onError: () => {
    throw new HTTPException(413, {
      message: `That file is too big. The cap is ${String(env.MAX_PRINT_FILE_MB)} MB.`,
    })
  },
})

const WRONG_KIND = `That doesn't look like a printable model. The slicer takes .stl and .step files.`

const placement = {
  x: z.number().finite().min(-1_000).max(1_000),
  y: z.number().finite().min(-1_000).max(1_000),
  qx: z.number().finite().min(-1).max(1),
  qy: z.number().finite().min(-1).max(1),
  qz: z.number().finite().min(-1).max(1),
  qw: z.number().finite().min(-1).max(1),
  sx: z.number().finite().min(MIN_SCALE).max(MAX_SCALE),
  sy: z.number().finite().min(MIN_SCALE).max(MAX_SCALE),
  sz: z.number().finite().min(MIN_SCALE).max(MAX_SCALE),
}

const objectId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[\w-]+$/)

const newObject = z.object({ id: objectId, ...placement })

const plateObject = z.object({
  id: objectId,
  modelId: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(120),
  ...placement,
})

const draftSettings = z.object({
  material: z.enum(['PLA', 'PETG']),
  preset: z.enum(PrintPreset),
  overrides: processOverrides,
})

const revision = z.object({ revision: z.number().int().min(1) })

const draftEdit = revision.extend({
  material: draftSettings.shape.material.optional(),
  preset: draftSettings.shape.preset.optional(),
  overrides: processOverrides.optional(),
  objects: z.array(plateObject).max(500).optional(),
})

const submitBody = revision.extend({
  projectId: z.string().min(1).max(64).nullable().optional(),
  notes: z.string().trim().max(1_000).nullable().optional(),
})

type Tx = Prisma.TransactionClient

/** One member's draft writes, one at a time. */
const lockMember = (tx: Tx, userId: string) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`print:${userId}`}))`

const manifestOr503 = () => {
  const manifest = sliceManifest()
  if (!manifest) {
    throw new HTTPException(503, { message: 'The slicer is unavailable right now.' })
  }
  return manifest
}

const notFound = () => new HTTPException(404, { message: 'No such draft.' })

const stale = (current: number) =>
  new HTTPException(409, {
    message: `This plate changed in another tab (revision ${String(current)}). Reload to see it.`,
  })

/** A multipart field as text, or undefined when it's absent or blank. */
const field = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined

function jsonField<T>(value: unknown, schema: z.ZodType<T>, message: string): T {
  const text = field(value)
  let parsed: unknown
  try {
    parsed = text === undefined ? undefined : JSON.parse(text)
  } catch {
    throw new HTTPException(400, { message })
  }
  const result = schema.safeParse(parsed)
  if (!result.success) throw new HTTPException(400, { message })
  return result.data
}

const baseName = (fileName: string) =>
  fileName.replace(/\.(stl|step|stp)$/i, '').slice(0, 120)

interface Upload {
  bytes: Uint8Array<ArrayBuffer>
  fileName: string
  sha256: string
  isStep: boolean
  triangles: number | null
}

/** Reads and checks one uploaded model. An STL is parsed now so a broken one never reaches Orca. */
async function readUpload(value: unknown): Promise<Upload> {
  if (!(value instanceof File) || value.size === 0) {
    throw new HTTPException(400, { message: 'Attach the model file itself.' })
  }
  const bytes = new Uint8Array(await value.arrayBuffer())
  const fileName = value.name.slice(0, 200)
  if (!looksLikePrintModel(fileName, bytes))
    throw new HTTPException(400, { message: WRONG_KIND })

  const isStep = /\.(step|stp)$/i.test(fileName)
  let triangles: number | null = null
  if (!isStep) {
    try {
      triangles = parseStl(bytes).length / 9
    } catch (error) {
      if (error instanceof MeshError)
        throw new HTTPException(400, { message: error.message })
      throw error
    }
  }
  return {
    bytes,
    fileName,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    isStep,
    triangles,
  }
}

async function checkStorage(extraBytes: number) {
  if ((await printStorageBytes()) + extraBytes > storageCapBytes()) {
    throw new HTTPException(507, {
      message: 'The print store is full right now. Try again once some prints are done.',
    })
  }
}

/** The model row, its stored upload, and one copy of it on the plate. */
async function addModel(
  tx: Tx,
  requestId: string,
  userId: string,
  upload: Upload,
  object: z.infer<typeof newObject>,
  position: { model: number; object: number },
) {
  const file = await tx.storedFile.create({
    data: {
      kind: FileKind.PRINT_MODEL,
      mimeType: upload.isStep ? 'model/step' : 'model/stl',
      byteSize: upload.bytes.byteLength,
      originalName: upload.fileName,
      data: upload.bytes,
      createdById: userId,
    },
    select: { id: true },
  })
  const model = await tx.printModel.create({
    data: {
      requestId,
      fileId: file.id,
      fileName: upload.fileName,
      fileSize: upload.bytes.byteLength,
      sha256: upload.sha256,
      position: position.model,
      meshState: upload.isStep ? SlicerJobState.QUEUED : SlicerJobState.READY,
      triangles: upload.triangles,
    },
    select: { id: true },
  })
  const taken = await tx.printObject.findUnique({
    where: { id: object.id },
    select: { id: true },
  })
  if (taken)
    throw new HTTPException(409, { message: 'That object id is already in use.' })
  await tx.printObject.create({
    data: {
      ...object,
      ...canonicalQuat(object),
      requestId,
      modelId: model.id,
      name: baseName(upload.fileName),
      position: position.object,
    },
  })
}

/** What the request reads as in lists and history: the first model, how many more, total size. */
async function refreshSummary(tx: Tx, requestId: string) {
  const models = await tx.printModel.findMany({
    where: { requestId },
    orderBy: { position: 'asc' },
    select: { fileName: true, fileSize: true },
  })
  const copies = await tx.printObject.count({ where: { requestId } })
  const first = models[0]?.fileName ?? 'Empty plate'
  await tx.printRequest.update({
    where: { id: requestId },
    data: {
      fileName:
        models.length > 1 ? `${first} and ${String(models.length - 1)} more` : first,
      fileSize: models.reduce((sum, model) => sum + model.fileSize, 0),
      quantity: Math.max(1, copies),
    },
  })
}

/** The whole draft as the workspace reads it. */
async function draftView(requestId: string) {
  const request = await prisma.printRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      userId: true,
      status: true,
      revision: true,
      material: true,
      preset: true,
      overrides: true,
      fileName: true,
      notes: true,
      projectId: true,
      createdAt: true,
      draftActiveAt: true,
      startedAt: true,
      submittedAt: true,
      models: {
        orderBy: { position: 'asc' },
        select: {
          id: true,
          fileName: true,
          fileSize: true,
          meshState: true,
          meshFailure: true,
          triangles: true,
        },
      },
      objects: {
        orderBy: { position: 'asc' },
        select: {
          id: true,
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
      },
      slice: {
        select: {
          state: true,
          fingerprint: true,
          profileSetHash: true,
          failure: true,
          retryable: true,
          estimatedGrams: true,
          estimatedSeconds: true,
          filamentMeters: true,
          layerCount: true,
          previewFileId: true,
          previewFailure: true,
          requestedAt: true,
        },
      },
    },
  })
  if (!request) throw notFound()

  const manifest = sliceManifest()
  const spec = await currentSpec(prisma, requestId)
  const fingerprint =
    manifest && spec ? fingerprintOf(spec, manifest.profileSetHash) : null
  const { slice, userId: _userId, ...rest } = request

  return {
    ...rest,
    expiresAt:
      request.status === PrintRequestStatus.DRAFT
        ? draftExpiry({
            createdAt: request.createdAt,
            draftActiveAt: request.draftActiveAt,
          })
        : null,
    slice: slice && {
      state: slice.state,
      current:
        fingerprint !== null &&
        slice.fingerprint === fingerprint &&
        slice.profileSetHash === manifest?.profileSetHash,
      failure: slice.failure,
      retryable: slice.retryable,
      estimatedGrams: slice.estimatedGrams,
      estimatedSeconds: slice.estimatedSeconds,
      filamentMeters: slice.filamentMeters,
      layerCount: slice.layerCount,
      hasPreview: slice.previewFileId !== null,
      previewFailure: slice.previewFailure,
      requestedAt: slice.requestedAt,
    },
  }
}

/** A draft of mine, or 404. Scalars only, so it's safe inside a transaction. */
async function myDraft(tx: Tx, id: string, userId: string) {
  const draft = await tx.printRequest.findUnique({
    where: { id },
    select: { id: true, userId: true, status: true, revision: true },
  })
  if (!draft || draft.userId !== userId || draft.status !== PrintRequestStatus.DRAFT) {
    throw notFound()
  }
  return draft
}

printDrafts.get('/workspace', requireAuth, requireDuesForRoute, async (c) => {
  const manifest = manifestOr503()
  return c.json({
    profiles: workspaceProfiles(manifest),
    workerOnline: await workerOnline(manifest.profileSetHash),
    limits: {
      drafts: env.PRINT_DRAFT_MAX,
      models: env.PRINT_PLATE_MAX_MODELS,
      objects: env.PRINT_PLATE_MAX_OBJECTS,
      fileMb: env.MAX_PRINT_FILE_MB,
      slicesPerHour: env.PRINT_SLICES_PER_HOUR,
    },
  })
})

printDrafts.get('/drafts', requireAuth, requireDuesForRoute, async (c) => {
  const drafts = await prisma.printRequest.findMany({
    where: { userId: c.get('user').id, status: PrintRequestStatus.DRAFT },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      fileName: true,
      quantity: true,
      material: true,
      preset: true,
      createdAt: true,
      draftActiveAt: true,
      slice: { select: { state: true } },
    },
  })
  return c.json(
    drafts.map(({ slice, ...draft }) => ({
      ...draft,
      sliceState: slice?.state ?? null,
      expiresAt: draftExpiry(draft),
    })),
  )
})

printDrafts.post(
  '/drafts',
  originGuard,
  requireAuth,
  requireDuesForRoute,
  uploadLimit,
  uploads,
  async (c) => {
    manifestOr503()
    const user = c.get('user')
    const body = await c.req.parseBody()
    const settings = jsonField(
      body['settings'],
      draftSettings,
      `Those slicer settings aren't valid.`,
    )
    const object = jsonField(
      body['object'],
      newObject,
      'Say where the model goes on the plate.',
    )
    const upload = await readUpload(body['file'])
    await checkStorage(upload.bytes.byteLength)
    const term = await currentTerm()

    const id = await prisma.$transaction(async (tx) => {
      await lockMember(tx, user.id)
      const drafts = await tx.printRequest.count({
        where: { userId: user.id, status: PrintRequestStatus.DRAFT },
      })
      if (drafts >= env.PRINT_DRAFT_MAX) {
        throw new HTTPException(409, {
          message: `You can keep ${String(env.PRINT_DRAFT_MAX)} drafts at once. Discard one first.`,
        })
      }
      const request = await tx.printRequest.create({
        data: {
          userId: user.id,
          status: PrintRequestStatus.DRAFT,
          process: PrintProcess.FDM,
          material: settings.material,
          preset: settings.preset,
          overrides: settings.overrides,
          fileName: upload.fileName,
          fileSize: upload.bytes.byteLength,
          termYear: term.year,
          termSeason: term.season,
          draftActiveAt: new Date(),
        },
        select: { id: true },
      })
      await addModel(tx, request.id, user.id, upload, object, { model: 0, object: 0 })
      return request.id
    })

    return c.json(await draftView(id), 201)
  },
)

printDrafts.get('/drafts/:id', requireAuth, requireDuesForRoute, async (c) => {
  const user = c.get('user')
  const draft = await prisma.printRequest.findUnique({
    where: { id: c.req.param('id') },
    select: { userId: true, preset: true },
  })
  // Submitted plates read here too, so the workspace can show one as it was sent.
  if (!draft || draft.userId !== user.id || draft.preset === null) throw notFound()
  return c.json(await draftView(c.req.param('id')))
})

printDrafts.post(
  '/drafts/:id/models',
  originGuard,
  requireAuth,
  requireDuesForRoute,
  uploadLimit,
  uploads,
  async (c) => {
    const user = c.get('user')
    const body = await c.req.parseBody()
    const seen = z.coerce.number().int().min(1).safeParse(field(body['revision']))
    if (!seen.success)
      throw new HTTPException(400, { message: 'Say which revision you saw.' })
    const object = jsonField(
      body['object'],
      newObject,
      'Say where the model goes on the plate.',
    )
    const upload = await readUpload(body['file'])
    await checkStorage(upload.bytes.byteLength)

    await prisma.$transaction(async (tx) => {
      await lockMember(tx, user.id)
      const draft = await myDraft(tx, c.req.param('id'), user.id)
      if (draft.revision !== seen.data) throw stale(draft.revision)
      const models = await tx.printModel.count({ where: { requestId: draft.id } })
      const copies = await tx.printObject.count({ where: { requestId: draft.id } })
      if (models >= env.PRINT_PLATE_MAX_MODELS) {
        throw new HTTPException(409, {
          message: `A plate holds ${String(env.PRINT_PLATE_MAX_MODELS)} different models at most.`,
        })
      }
      if (copies >= env.PRINT_PLATE_MAX_OBJECTS) {
        throw new HTTPException(409, {
          message: `A plate holds ${String(env.PRINT_PLATE_MAX_OBJECTS)} objects at most.`,
        })
      }
      const last = await tx.printModel.aggregate({
        where: { requestId: draft.id },
        _max: { position: true },
      })
      await addModel(tx, draft.id, user.id, upload, object, {
        model: (last._max.position ?? -1) + 1,
        object: copies,
      })
      await tx.printRequest.update({
        where: { id: draft.id },
        data: { revision: { increment: 1 }, draftActiveAt: new Date() },
      })
      await refreshSummary(tx, draft.id)
    })

    return c.json(await draftView(c.req.param('id')))
  },
)

printDrafts.patch(
  '/drafts/:id',
  originGuard,
  requireAuth,
  requireDuesForRoute,
  edits,
  validate('json', draftEdit),
  async (c) => {
    const user = c.get('user')
    const edit = c.req.valid('json')

    await prisma.$transaction(async (tx) => {
      const draft = await myDraft(tx, c.req.param('id'), user.id)
      if (draft.revision !== edit.revision) throw stale(draft.revision)

      if (edit.objects) {
        if (edit.objects.length > env.PRINT_PLATE_MAX_OBJECTS) {
          throw new HTTPException(409, {
            message: `A plate holds ${String(env.PRINT_PLATE_MAX_OBJECTS)} objects at most.`,
          })
        }
        const ids = new Set(edit.objects.map((object) => object.id))
        if (ids.size !== edit.objects.length) {
          throw new HTTPException(400, { message: 'Two objects have the same id.' })
        }
        const models = await tx.printModel.findMany({
          where: { requestId: draft.id },
          select: { id: true },
        })
        const known = new Set(models.map((model) => model.id))
        if (edit.objects.some((object) => !known.has(object.modelId))) {
          throw new HTTPException(400, {
            message: `An object names a model this plate doesn't have.`,
          })
        }
        // An id another plate already uses can't be taken over.
        const elsewhere = await tx.printObject.count({
          where: { id: { in: [...ids] }, requestId: { not: draft.id } },
        })
        if (elsewhere > 0) {
          throw new HTTPException(409, { message: 'That object id is already in use.' })
        }

        await tx.printObject.deleteMany({ where: { requestId: draft.id } })
        await tx.printObject.createMany({
          data: edit.objects.map((object, position) => ({
            ...object,
            ...canonicalQuat(object),
            requestId: draft.id,
            position,
          })),
        })

        const used = new Set(edit.objects.map((object) => object.modelId))
        const unused = models.map((model) => model.id).filter((id) => !used.has(id))
        if (unused.length > 0) {
          await deleteModelFiles(tx, unused)
          await tx.printModel.deleteMany({ where: { id: { in: unused } } })
        }
      }

      await tx.printRequest.update({
        where: { id: draft.id },
        data: {
          ...(edit.material ? { material: edit.material } : {}),
          ...(edit.preset ? { preset: edit.preset } : {}),
          ...(edit.overrides ? { overrides: edit.overrides } : {}),
          revision: { increment: 1 },
          draftActiveAt: new Date(),
        },
      })
      if (edit.objects) await refreshSummary(tx, draft.id)
    })

    return c.json(await draftView(c.req.param('id')))
  },
)

printDrafts.post(
  '/drafts/:id/slice',
  originGuard,
  requireAuth,
  requireDuesForRoute,
  edits,
  validate('json', revision),
  async (c) => {
    const manifest = manifestOr503()
    const user = c.get('user')
    const { revision: seen } = c.req.valid('json')

    if (!(await workerOnline(manifest.profileSetHash))) {
      throw new HTTPException(503, {
        message:
          'The slicer is offline right now. Your plate is saved; try again in a few minutes.',
      })
    }

    await prisma.$transaction(async (tx) => {
      await lockMember(tx, user.id)
      const draft = await myDraft(tx, c.req.param('id'), user.id)
      if (draft.revision !== seen) throw stale(draft.revision)

      const models = await tx.printModel.findMany({
        where: { requestId: draft.id },
        select: {
          id: true,
          meshState: true,
          meshFailure: true,
          triangles: true,
          fileName: true,
        },
      })
      const failed = models.find((model) => model.meshState === SlicerJobState.FAILED)
      if (failed) {
        throw new HTTPException(409, {
          message: `${failed.fileName}: ${failed.meshFailure ?? `it couldn't be converted.`} Remove it to slice the rest.`,
        })
      }
      if (models.some((model) => model.meshState !== SlicerJobState.READY)) {
        throw new HTTPException(409, {
          message: 'A STEP file is still being converted. Give it a moment.',
        })
      }

      const spec = await currentSpec(tx, draft.id)
      if (!spec || spec.objects.length === 0) {
        throw new HTTPException(409, { message: 'Put something on the plate first.' })
      }
      if (spec.overrides['spiral_mode'] === true && spec.objects.length > 1) {
        throw new HTTPException(409, {
          message:
            'Vase mode prints one object at a time. Remove the other copies or turn it off.',
        })
      }
      const triangles = new Map(models.map((model) => [model.id, model.triangles ?? 0]))
      const placed = spec.objects.reduce(
        (sum, object) => sum + (triangles.get(object.modelId) ?? 0),
        0,
      )
      if (placed > env.PRINT_PLATE_MAX_TRIANGLES) {
        throw new HTTPException(409, {
          message:
            'The plate is too detailed to slice. Use fewer copies or a simpler model.',
        })
      }

      const fingerprint = fingerprintOf(spec, manifest.profileSetHash)
      const existing = await tx.printSlice.findUnique({
        where: { requestId: draft.id },
        select: {
          fingerprint: true,
          state: true,
          retryable: true,
          outputFileId: true,
          previewFileId: true,
        },
      })
      if (existing?.fingerprint === fingerprint) {
        const reusable =
          existing.state === SlicerJobState.QUEUED ||
          existing.state === SlicerJobState.RUNNING ||
          existing.state === SlicerJobState.READY ||
          !existing.retryable
        if (reusable) {
          await tx.printRequest.update({
            where: { id: draft.id },
            data: { draftActiveAt: new Date() },
          })
          return
        }
      }

      const busy = await tx.printSlice.count({
        where: {
          requestId: { not: draft.id },
          state: { in: [SlicerJobState.QUEUED, SlicerJobState.RUNNING] },
          request: { userId: user.id },
        },
      })
      if (busy > 0) {
        throw new HTTPException(409, {
          message: 'Another of your plates is slicing. Wait for it to finish.',
        })
      }

      const budget = await consume(`slice:${user.id}`, env.PRINT_SLICES_PER_HOUR, 3_600)
      if (!budget.allowed) {
        c.header('Retry-After', String(budget.retryAfter))
        throw new HTTPException(429, {
          message: `That's ${String(env.PRINT_SLICES_PER_HOUR)} slices this hour. Try again in a bit.`,
        })
      }

      // The last result belongs to a plate that no longer exists; its files go now.
      const old = [existing?.outputFileId, existing?.previewFileId].filter(
        (value): value is string => typeof value === 'string',
      )
      if (old.length > 0) await tx.storedFile.deleteMany({ where: { id: { in: old } } })

      const job = {
        state: SlicerJobState.QUEUED,
        revision: draft.revision,
        spec,
        fingerprint,
        profileSetHash: manifest.profileSetHash,
        orcaVersion: null,
        outputFileId: null,
        previewFileId: null,
        previewFailure: null,
        layerCount: null,
        estimatedGrams: null,
        estimatedSeconds: null,
        filamentMeters: null,
        failure: null,
        retryable: false,
        attempts: 0,
        leaseToken: null,
        leaseExpiresAt: null,
        requestedAt: new Date(),
        startedAt: null,
        finishedAt: null,
      }
      await tx.printSlice.upsert({
        where: { requestId: draft.id },
        create: { requestId: draft.id, ...job },
        update: job,
      })
      await tx.printRequest.update({
        where: { id: draft.id },
        data: { draftActiveAt: new Date() },
      })
    })

    return c.json(await draftView(c.req.param('id')))
  },
)

printDrafts.get('/drafts/:id/preview', requireAuth, async (c) => {
  const user = c.get('user')
  const request = await prisma.printRequest.findUnique({
    where: { id: c.req.param('id') },
    select: { userId: true, status: true, slice: { select: { previewFileId: true } } },
  })
  const mayRead =
    request &&
    (request.userId === user.id ||
      (isOfficer(user) && request.status !== PrintRequestStatus.DRAFT))
  if (!request || !mayRead) throw notFound()
  const fileId = request.slice?.previewFileId
  const file = fileId
    ? await prisma.storedFile.findUnique({
        where: { id: fileId },
        select: { data: true },
      })
    : null
  if (!file) throw new HTTPException(404, { message: 'This plate has no preview.' })

  c.header('Cache-Control', 'private, no-store')
  c.header('Content-Type', 'application/octet-stream')
  return c.body(new Uint8Array(file.data))
})

printDrafts.get('/models/:id/mesh', requireAuth, async (c) => {
  const user = c.get('user')
  const model = await prisma.printModel.findUnique({
    where: { id: c.req.param('id') },
    select: {
      fileId: true,
      meshFileId: true,
      meshState: true,
      request: { select: { userId: true, status: true } },
    },
  })
  const mayRead =
    model &&
    (model.request.userId === user.id ||
      (isOfficer(user) && model.request.status !== PrintRequestStatus.DRAFT))
  if (!model || !mayRead) throw new HTTPException(404, { message: 'No such model.' })
  if (model.meshState !== SlicerJobState.READY) {
    throw new HTTPException(409, { message: 'This model is still being converted.' })
  }
  const fileId = model.meshFileId ?? model.fileId
  const file = fileId
    ? await prisma.storedFile.findUnique({
        where: { id: fileId },
        select: { data: true },
      })
    : null
  if (!file) throw new HTTPException(404, { message: `This model's file is gone.` })

  // Members' parts aren't kept in browser caches; they're deleted when the print settles.
  c.header('Cache-Control', 'private, no-store')
  c.header('Content-Type', 'model/stl')
  return c.body(new Uint8Array(file.data))
})

printDrafts.post(
  '/drafts/:id/submit',
  originGuard,
  requireAuth,
  requireDuesForRoute,
  submissions,
  validate('json', submitBody),
  async (c) => {
    const manifest = manifestOr503()
    const user = c.get('user')
    const body = c.req.valid('json')
    const projectId = body.projectId ?? null

    if (projectId) {
      // A plain membership row, not `requireProjectMember`, which waves officers through and
      // would let an officer bill any print to any project.
      const membership = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: user.id } },
        select: { projectId: true },
      })
      if (!membership) {
        throw new HTTPException(403, {
          message: 'You can only put a print against a project you are on.',
        })
      }
    }
    const term = await currentTerm()

    const sent = await prisma.$transaction(async (tx) => {
      await lockMember(tx, user.id)
      const draft = await myDraft(tx, c.req.param('id'), user.id)
      if (draft.revision !== body.revision) throw stale(draft.revision)

      const spec = await currentSpec(tx, draft.id)
      const slice = await tx.printSlice.findUnique({
        where: { requestId: draft.id },
        select: {
          state: true,
          fingerprint: true,
          profileSetHash: true,
          estimatedGrams: true,
          estimatedSeconds: true,
          outputFileId: true,
        },
      })
      const current =
        spec !== null &&
        slice?.state === SlicerJobState.READY &&
        slice.outputFileId !== null &&
        slice.profileSetHash === manifest.profileSetHash &&
        slice.fingerprint === fingerprintOf(spec, manifest.profileSetHash)
      if (!current) {
        throw new HTTPException(409, {
          message: 'Slice the plate again before sending it.',
        })
      }

      return tx.printRequest.update({
        where: { id: draft.id },
        data: {
          status: PrintRequestStatus.PENDING,
          submittedAt: new Date(),
          draftActiveAt: null,
          // Charged to the term it was sent in, not the one the draft was started in.
          termYear: term.year,
          termSeason: term.season,
          estimatedGrams: slice.estimatedGrams,
          estimatedSeconds: slice.estimatedSeconds,
          projectId,
          notes: body.notes || null,
        },
        select: printSelect,
      })
    })

    const forWhom = sent.project ? `for ${sent.project.title}` : 'personal'
    const copies = sent.quantity > 1 ? ` ×${String(sent.quantity)}` : ''
    const preset = sent.preset ? manifest.presets[sent.preset].label : ''
    const grams =
      sent.estimatedGrams === null
        ? ''
        : `, about ${String(Math.ceil(sent.estimatedGrams))} g`
    void notifyOfficers(
      `🖨️ New 3D print from ${user.fullName}: ${sent.fileName}${copies} (${MATERIAL_LABEL[sent.material]}, ${preset}${grams}), ${forWhom}. Queue: ${env.SITE_URL}/dashboard/officer/print`,
    ).catch((error: unknown) => {
      console.error('officer notify failed', error)
    })

    return c.json(sent)
  },
)

printDrafts.post(
  '/:id/unsubmit',
  originGuard,
  requireAuth,
  requireDuesForRoute,
  edits,
  async (c) => {
    const user = c.get('user')
    await prisma.$transaction(async (tx) => {
      await lockMember(tx, user.id)
      const request = await tx.printRequest.findUnique({
        where: { id: c.req.param('id') },
        select: { id: true, userId: true, status: true, preset: true },
      })
      if (!request || request.userId !== user.id || request.preset === null) {
        throw new HTTPException(404, { message: 'No such print request.' })
      }
      if (request.status !== PrintRequestStatus.PENDING) {
        throw new HTTPException(409, {
          message: 'This print is already being handled. Talk to the officer on it.',
        })
      }
      const drafts = await tx.printRequest.count({
        where: { userId: user.id, status: PrintRequestStatus.DRAFT },
      })
      if (drafts >= env.PRINT_DRAFT_MAX) {
        throw new HTTPException(409, {
          message: `You can keep ${String(env.PRINT_DRAFT_MAX)} drafts at once. Discard one first.`,
        })
      }
      await tx.printRequest.update({
        where: { id: request.id },
        data: {
          status: PrintRequestStatus.DRAFT,
          submittedAt: null,
          draftActiveAt: new Date(),
          estimatedGrams: null,
          estimatedSeconds: null,
          revision: { increment: 1 },
        },
      })
    })
    return c.json(await draftView(c.req.param('id')))
  },
)

printDrafts.delete(
  '/drafts/:id',
  originGuard,
  requireAuth,
  requireDuesForRoute,
  edits,
  async (c) => {
    const user = c.get('user')
    await prisma.$transaction(async (tx) => {
      const draft = await myDraft(tx, c.req.param('id'), user.id)
      await deleteRequests(tx, [draft.id])
    })
    return c.json({ deleted: true })
  },
)
