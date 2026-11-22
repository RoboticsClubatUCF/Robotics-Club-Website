import { Worker } from 'node:worker_threads'
import { prisma } from '../core/db.js'
import { PrintRequestStatus } from '../generated/prisma/enums.js'
import type { Placement } from './plateTransform.js'
import type { ThumbnailJob } from './thumbnailWorker.js'

/**
 * A small picture of a print for the queue, so whoever is at the printer can tell which part is
 * which. Drawn on request from the bytes the print already holds, and refused once they're gone.
 */

/** A model that takes longer gets no picture. Cheaper than holding up every other card. */
const RENDER_DEADLINE_MS = 15_000
const CACHED_THUMBNAILS = 128

const isStl = (name: string) => name.toLowerCase().endsWith('.stl')

/** The mesh a plate's model draws from: the worker's for a STEP, the upload for an STL. */
const meshFileOf = (model: { fileName: string; fileId: string | null; meshFileId: string | null }) =>
  model.meshFileId ?? (isStl(model.fileName) ? model.fileId : null)

export interface PreviewSource {
  fileId: string | null
  fileName: string
  slicedWith: unknown
  models: { id: string; fileName: string; fileId: string | null; meshFileId: string | null }[]
  objects: { modelId: string }[]
}

/** Whether there's a mesh to draw. A resin STEP has none, and a settled print has no files. */
export function hasPreview(print: PreviewSource): boolean {
  if (print.slicedWith === null) return print.fileId !== null && isStl(print.fileName)
  return (
    print.objects.length > 0 &&
    print.objects.every((object) => {
      const model = print.models.find((candidate) => candidate.id === object.modelId)
      return model !== undefined && meshFileOf(model) !== null
    })
  )
}

const IDENTITY: Placement = { x: 0, y: 0, qx: 0, qy: 0, qz: 0, qw: 1, sx: 1, sy: 1, sz: 1 }

const readPrint = (id: string) =>
  prisma.printRequest.findUnique({
    where: { id },
    select: {
      status: true,
      revision: true,
      fileId: true,
      fileName: true,
      slicedWith: true,
      models: { select: { id: true, fileName: true, fileId: true, meshFileId: true } },
      objects: {
        select: {
          modelId: true,
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
    },
  })

type Print = NonNullable<Awaited<ReturnType<typeof readPrint>>>

const drawable = (print: Print | null): print is Print =>
  print !== null && print.status !== PrintRequestStatus.DRAFT && hasPreview(print)

async function stlBytes(id: string): Promise<Uint8Array | null> {
  const file = await prisma.storedFile.findUnique({ where: { id }, select: { data: true } })
  return file?.data ?? null
}

async function jobFor(print: Print): Promise<ThumbnailJob | null> {
  if (print.slicedWith === null) {
    const stl = await stlBytes(print.fileId!)
    return stl && { models: [{ stl, placements: [IDENTITY] }] }
  }

  const models: ThumbnailJob['models'] = []
  for (const model of print.models) {
    const placements = print.objects.filter((object) => object.modelId === model.id)
    if (placements.length === 0) continue
    const stl = await stlBytes(meshFileOf(model)!)
    if (!stl) return null
    models.push({ stl, placements })
  }
  return { models }
}

// The running module's own extension: `.ts` under tsx, which the thread has to load too.
const workerFile = new URL(
  `./thumbnailWorker${import.meta.url.endsWith('.ts') ? '.ts' : '.js'}`,
  import.meta.url,
)

/** The picture, or null if the thread failed or ran out of time. */
function renderInThread(job: ThumbnailJob): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const worker = new Worker(workerFile, {
      workerData: job,
      execArgv: import.meta.url.endsWith('.ts') ? ['--import', import.meta.resolve('tsx')] : [],
      resourceLimits: { maxOldGenerationSizeMb: 512 },
    })
    const finish = (png: Uint8Array | null) => {
      clearTimeout(deadline)
      resolve(png)
      void worker.terminate()
    }
    const deadline = setTimeout(() => {
      console.error('print thumbnail ran out of time')
      finish(null)
    }, RENDER_DEADLINE_MS)

    worker.once('message', (png: Uint8Array) => {
      finish(png)
    })
    worker.once('error', (error) => {
      console.error('print thumbnail failed', error)
      finish(null)
    })
    worker.once('exit', () => {
      finish(null)
    })
  })
}

/** Finished pictures by print and revision, oldest first. Null remembers one that can't be drawn. */
const cache = new Map<string, Uint8Array | null>()
const drawing = new Map<string, Promise<Uint8Array | null>>()
let tail: Promise<unknown> = Promise.resolve()

const forget = (requestId: string) => {
  for (const key of cache.keys()) if (key.startsWith(`${requestId}:`)) cache.delete(key)
}

/**
 * The print's picture as it stands, or null. One thread at a time, so a queue of big models
 * opening at once can't hold all of their bytes in memory together.
 */
export async function printThumbnail(requestId: string): Promise<Uint8Array | null> {
  // Asked every time, cached or not: a settled print's picture goes with its files.
  const print = await readPrint(requestId)
  if (!drawable(print)) {
    forget(requestId)
    return null
  }

  const key = `${requestId}:${print.revision}`
  const held = cache.get(key)
  if (held !== undefined) return held

  const running = drawing.get(key)
  if (running) return running

  const job = tail.then(async () => {
    // It may have waited a while. The owner can have taken it back and changed it since.
    const now = await readPrint(requestId)
    if (!drawable(now) || now.revision !== print.revision) return null

    const work = await jobFor(now)
    if (!work) return null

    const png = await renderInThread(work)
    cache.set(key, png)
    if (cache.size > CACHED_THUMBNAILS) cache.delete(cache.keys().next().value!)
    return png
  })
  const settled = job.finally(() => {
    drawing.delete(key)
  })
  drawing.set(key, settled)
  tail = settled.catch(() => undefined)
  return settled
}
