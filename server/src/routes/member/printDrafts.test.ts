import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.js'
import { createSession } from '../../auth/session.js'
import { prisma } from '../../core/db.js'
import { env } from '../../core/env.js'
import { notifyOfficers } from '../../discord/officerNotify.js'
import {
  FileKind,
  PrintRequestStatus,
  Season,
  SlicerJobState,
  UserRole,
} from '../../generated/prisma/enums.js'
import { sweepPrintDrafts } from '../../printing/printLifecycle.js'
import { sliceManifest } from '../../printing/profiles.js'
import { writeBinaryStl } from '../../printing/stl.js'

/**
 * Filament drafts, slicing and submitting, against the database.
 *
 * Nothing here runs Orca. The worker's half is played by `finishSlice`, which writes a READY
 * result the way `publishSlice` does; the real CLI is covered by `sliceSmoke.ts` in the worker
 * image. A fake heartbeat row stands in for a running worker. A real worker on the same database
 * would claim the jobs queued here, so stop it (`docker compose stop slicer`) or point
 * DATABASE_URL at a scratch database.
 *
 * Discord is stubbed twice over: real officers in the dev database have real Discord ids, and the
 * officer notice is counted at its own module so the count doesn't depend on who's an officer.
 */

vi.mock('../../discord/discord.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../discord/discord.js')>()),
  discordConfigured: true,
  sendDirectMessage: vi.fn(() =>
    Promise.resolve({ status: 'refused' as const, reason: 'privacy settings' }),
  ),
}))

vi.mock('../../discord/officerNotify.js', () => ({
  notifyOfficers: vi.fn(() => Promise.resolve()),
}))

const PREFIX = 'test-draft-'
const email = (name: string) => `${PREFIX}${name}@ucf.edu`
const PAID_UP = new Date('2035-12-31T23:59:59')
const SURVEYED = new Date('2035-09-01T00:00:00')
const WORKER = `${PREFIX}worker`

const manifest = sliceManifest()!
const limits = {
  drafts: env.PRINT_DRAFT_MAX,
  slices: env.PRINT_SLICES_PER_HOUR,
}

const clearWindows = () =>
  prisma.rateLimit.deleteMany({
    where: {
      OR: ['print:', 'printDraft:', 'printUpload:', 'officer:', 'slice:'].map((key) => ({
        key: { startsWith: key },
      })),
    },
  })

async function clearRows() {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: PREFIX } },
    select: { id: true },
  })
  const ids = users.map((user) => user.id)
  // Sliced files have no uploader, so they're named with the prefix and found by it.
  await prisma.storedFile.deleteMany({
    where: {
      OR: [{ createdById: { in: ids } }, { originalName: { startsWith: PREFIX } }],
    },
  })
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
  await prisma.project.deleteMany({ where: { slug: { startsWith: PREFIX } } })
  await prisma.slicerWorker.deleteMany({ where: { id: WORKER } })
}

const cookieFor = async (userId: string) =>
  `${env.SESSION_COOKIE_NAME}=${(await createSession(userId)).token}`

let memberCookie: string
let otherCookie: string
let officerCookie: string
let memberId: string
let projectId: string

beforeEach(async () => {
  await clearWindows()
  await clearRows()
  env.PRINT_DRAFT_MAX = limits.drafts
  env.PRINT_SLICES_PER_HOUR = limits.slices
  vi.mocked(notifyOfficers).mockClear()

  const make = (name: string, role: UserRole) =>
    prisma.user.create({
      data: {
        fullName: `Draft ${name}`,
        email: email(name),
        role,
        duesPaidThrough: PAID_UP,
        surveyCompletedAt: SURVEYED,
      },
    })
  const [member, other, officer] = await Promise.all([
    make('member', UserRole.MEMBER),
    make('other', UserRole.MEMBER),
    make('officer', UserRole.OFFICER),
  ])
  memberId = member.id
  memberCookie = await cookieFor(member.id)
  otherCookie = await cookieFor(other.id)
  officerCookie = await cookieFor(officer.id)

  const project = await prisma.project.create({
    data: {
      slug: `${PREFIX}rover`,
      title: 'Draft Fixture Rover',
      termYear: 2035,
      termSeason: Season.FALL,
      members: { create: { userId: member.id } },
    },
  })
  projectId = project.id

  await prisma.slicerWorker.create({
    data: {
      id: WORKER,
      orcaVersion: manifest.orcaVersion,
      profileSetHash: manifest.profileSetHash,
      seenAt: new Date(),
    },
  })
})

afterAll(async () => {
  env.PRINT_DRAFT_MAX = limits.drafts
  env.PRINT_SLICES_PER_HOUR = limits.slices
  await clearWindows()
  await clearRows()
  await prisma.$disconnect()
})

/** A 20 mm cube as binary STL. */
function cube(size = 20): Uint8Array<ArrayBuffer> {
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
  return new Uint8Array(
    writeBinaryStl(
      Float32Array.from(faces.flatMap((face) => face.flatMap((i) => v[i]!))),
    ),
  )
}

const stepFile = () =>
  new TextEncoder().encode(
    'ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n',
  )

const objectId = () => `${PREFIX}${randomUUID()}`
const placed = (x = 128, y = 128) => ({
  id: objectId(),
  x,
  y,
  qx: 0,
  qy: 0,
  qz: 0,
  qw: 1,
  sx: 1,
  sy: 1,
  sz: 1,
})

const SETTINGS = { material: 'PLA', preset: 'STANDARD', overrides: {} }

interface Draft {
  id: string
  status: string
  revision: number
  material: string
  preset: string
  overrides: Record<string, unknown>
  models: { id: string; fileName: string; meshState: string }[]
  objects: ({ modelId: string; name: string } & ReturnType<typeof placed>)[]
  slice: null | { state: string; current: boolean; estimatedGrams: number | null }
  expiresAt: string | null
}

function createDraft(
  cookie = memberCookie,
  options: { file?: Uint8Array<ArrayBuffer>; name?: string; settings?: unknown } = {},
) {
  const form = new FormData()
  form.append(
    'file',
    new File([options.file ?? cube()], options.name ?? `${PREFIX}cube.stl`),
  )
  form.append('settings', JSON.stringify(options.settings ?? SETTINGS))
  form.append('object', JSON.stringify(placed()))
  return app.request('/api/print/drafts', {
    method: 'POST',
    body: form,
    headers: { cookie },
  })
}

async function newDraft(cookie = memberCookie): Promise<Draft> {
  const response = await createDraft(cookie)
  expect(response.status).toBe(201)
  return (await response.json()) as Draft
}

const send = (method: string, path: string, body: unknown, cookie = memberCookie) =>
  app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(body),
  })

const read = async (id: string, cookie = memberCookie) =>
  (await (
    await app.request(`/api/print/drafts/${id}`, { headers: { cookie } })
  ).json()) as Draft

const slice = (draft: Draft, cookie = memberCookie) =>
  send(
    'POST',
    `/api/print/drafts/${draft.id}/slice`,
    { revision: draft.revision },
    cookie,
  )

/** The worker's half: a READY result with a .3mf and a preview. */
async function finishSlice(requestId: string, grams = 36.2) {
  const output = await prisma.storedFile.create({
    data: {
      kind: FileKind.PRINT_SLICE,
      mimeType: 'model/3mf',
      byteSize: 4,
      originalName: `${PREFIX}plate.3mf`,
      data: new Uint8Array([80, 75, 3, 4]),
    },
  })
  const preview = await prisma.storedFile.create({
    data: {
      kind: FileKind.PRINT_PREVIEW,
      mimeType: 'application/octet-stream',
      byteSize: 3,
      originalName: `${PREFIX}preview.rcpv`,
      data: new Uint8Array([1, 2, 3]),
    },
  })
  await prisma.printSlice.update({
    where: { requestId },
    data: {
      state: SlicerJobState.READY,
      outputFileId: output.id,
      previewFileId: preview.id,
      estimatedGrams: grams,
      estimatedSeconds: 3_600,
      layerCount: 100,
      finishedAt: new Date(),
    },
  })
  return { output: output.id, preview: preview.id }
}

/** A draft sliced and ready to send. */
async function slicedDraft(): Promise<Draft> {
  const draft = await newDraft()
  expect((await slice(draft)).status).toBe(200)
  await finishSlice(draft.id)
  return read(draft.id)
}

const submit = (draft: Draft, body: Record<string, unknown> = {}) =>
  send('POST', `/api/print/drafts/${draft.id}/submit`, {
    revision: draft.revision,
    ...body,
  })

const settle = (id: string, body: unknown) =>
  send('PATCH', `/api/officer/print/${id}`, body, officerCookie)

describe('the workspace', () => {
  it('names the presets, the bed and whether the slicer is up', async () => {
    const response = await app.request('/api/print/workspace', {
      headers: { cookie: memberCookie },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      profiles: {
        presets: { key: string; values: Record<string, unknown> }[]
        bed: { width: number }
      }
      workerOnline: boolean
    }
    expect(body.profiles.presets.map((preset) => preset.key)).toEqual([
      'STANDARD',
      'Q',
      'QS',
    ])
    expect(body.profiles.presets[0]!.values['wall_loops']).toBe(2)
    expect(body.profiles.bed.width).toBe(256)
    expect(body.workerOnline).toBe(true)
    // Names and numbers only.
    expect(JSON.stringify(body)).not.toContain('sha256')
  })
})

describe('drafts', () => {
  it('starts a private draft with one model and one copy', async () => {
    const draft = await newDraft()
    expect(draft).toMatchObject({
      status: 'DRAFT',
      revision: 1,
      material: 'PLA',
      preset: 'STANDARD',
    })
    expect(draft.models).toHaveLength(1)
    expect(draft.models[0]!.meshState).toBe('READY')
    expect(draft.objects).toHaveLength(1)
    expect(draft.objects[0]!.name).toBe(`${PREFIX}cube`)
    expect(draft.expiresAt).not.toBeNull()

    // Not in the member's history, and nowhere an officer can see.
    const history = (await (
      await app.request('/api/me/print-requests', { headers: { cookie: memberCookie } })
    ).json()) as { id: string }[]
    expect(history.some((row) => row.id === draft.id)).toBe(false)
    const queue = (await (
      await app.request('/api/officer/print-queue?all=1', {
        headers: { cookie: officerCookie },
      })
    ).json()) as { id: string }[]
    expect(queue.some((row) => row.id === draft.id)).toBe(false)
    expect((await settle(draft.id, { status: 'PRINTING' })).status).toBe(404)
  })

  it('keeps a member to their draft limit', async () => {
    env.PRINT_DRAFT_MAX = 2
    await newDraft()
    await newDraft()
    const third = await createDraft()
    expect(third.status).toBe(409)
  })

  it.each([
    [
      'a file that isn’t a model',
      { file: new TextEncoder().encode('%PDF-1.4'), name: 'x.stl' },
    ],
    [
      'settings out of bounds',
      { settings: { ...SETTINGS, overrides: { layer_height: 0.5 } } },
    ],
    [
      'a setting members can’t change',
      { settings: { ...SETTINGS, overrides: { nozzle_temperature: 260 } } },
    ],
    ['resin', { settings: { ...SETTINGS, material: 'ABS_LIKE_RESIN' } }],
  ])('refuses %s', async (_case, options) => {
    const response = await createDraft(
      memberCookie,
      options as Parameters<typeof createDraft>[1],
    )
    expect(response.status).toBe(400)
  })

  it('is invisible to everybody else', async () => {
    const draft = await newDraft()
    expect(
      (
        await app.request(`/api/print/drafts/${draft.id}`, {
          headers: { cookie: otherCookie },
        })
      ).status,
    ).toBe(404)
    expect(
      (await send('PATCH', `/api/print/drafts/${draft.id}`, { revision: 1 }, otherCookie))
        .status,
    ).toBe(404)
    const mesh = await app.request(`/api/print/models/${draft.models[0]!.id}/mesh`, {
      headers: { cookie: otherCookie },
    })
    expect(mesh.status).toBe(404)
    const own = await app.request(`/api/print/models/${draft.models[0]!.id}/mesh`, {
      headers: { cookie: memberCookie },
    })
    expect(own.status).toBe(200)
    expect(new Uint8Array(await own.arrayBuffer())).toEqual(cube())
  })
})

describe('editing the plate', () => {
  it('refuses an edit made against an old revision', async () => {
    const draft = await newDraft()
    const first = await send('PATCH', `/api/print/drafts/${draft.id}`, {
      revision: 1,
      preset: 'Q',
    })
    expect(first.status).toBe(200)
    expect(((await first.json()) as Draft).revision).toBe(2)

    const stale = await send('PATCH', `/api/print/drafts/${draft.id}`, {
      revision: 1,
      preset: 'QS',
    })
    expect(stale.status).toBe(409)
    expect((await read(draft.id)).preset).toBe('Q')
  })

  it('copies share one model, and a model with no copies left waits for undo', async () => {
    const draft = await newDraft()
    const model = draft.models[0]!
    const original = draft.objects[0]!
    const copy = {
      ...original,
      ...placed(60, 60),
      modelId: model.id,
      name: original.name,
    }

    const doubled = (await (
      await send('PATCH', `/api/print/drafts/${draft.id}`, {
        revision: 1,
        objects: [original, copy],
      })
    ).json()) as Draft
    expect(doubled.objects).toHaveLength(2)
    expect(doubled.models).toHaveLength(1)

    const fileId = (
      await prisma.printModel.findUniqueOrThrow({ where: { id: model.id } })
    ).fileId!
    const emptied = await send('PATCH', `/api/print/drafts/${draft.id}`, {
      revision: 2,
      objects: [],
    })
    expect(emptied.status).toBe(200)
    expect(await prisma.storedFile.findUnique({ where: { id: fileId } })).not.toBeNull()

    // Undo: the copy comes back on the model that was kept.
    const restored = await send('PATCH', `/api/print/drafts/${draft.id}`, {
      revision: 3,
      objects: [original],
    })
    expect(restored.status).toBe(200)
    expect(((await restored.json()) as Draft).objects).toHaveLength(1)
  })

  it('sends a plate without the models nothing on it uses', async () => {
    const draft = await newDraft()
    const form = new FormData()
    form.append('file', new File([cube()], `${PREFIX}second.stl`))
    form.append('revision', '1')
    form.append('object', JSON.stringify(placed(60, 60)))
    const added = (await (
      await app.request(`/api/print/drafts/${draft.id}/models`, {
        method: 'POST',
        body: form,
        headers: { cookie: memberCookie },
      })
    ).json()) as Draft & { fileName: string }
    const second = added.models[1]!
    const secondFile = (
      await prisma.printModel.findUniqueOrThrow({ where: { id: second.id } })
    ).fileId!

    const kept = (await (
      await send('PATCH', `/api/print/drafts/${draft.id}`, {
        revision: 2,
        objects: [draft.objects[0]!],
      })
    ).json()) as Draft & { fileName: string }
    expect(kept.models).toHaveLength(2)
    expect(kept.fileName).toBe(`${PREFIX}cube.stl`)

    expect((await slice(kept)).status).toBe(200)
    await finishSlice(draft.id)
    expect((await submit(kept)).status).toBe(200)
    expect(await prisma.printModel.findUnique({ where: { id: second.id } })).toBeNull()
    expect(await prisma.storedFile.findUnique({ where: { id: secondFile } })).toBeNull()
  })

  it('stores only the settings that were changed, and refuses one out of bounds', async () => {
    const draft = await newDraft()
    const edited = (await (
      await send('PATCH', `/api/print/drafts/${draft.id}`, {
        revision: 1,
        overrides: { wall_loops: 4, sparse_infill_pattern: 'gyroid' },
      })
    ).json()) as Draft
    expect(edited.overrides).toEqual({ wall_loops: 4, sparse_infill_pattern: 'gyroid' })

    const bad = await send('PATCH', `/api/print/drafts/${draft.id}`, {
      revision: 2,
      overrides: { wall_loops: 40 },
    })
    expect(bad.status).toBe(400)
  })

  it('won’t let one plate take over another plate’s object', async () => {
    const mine = await newDraft()
    const theirs = await newDraft(otherCookie)
    const stolen = { ...theirs.objects[0]!, modelId: mine.models[0]!.id }
    const response = await send('PATCH', `/api/print/drafts/${mine.id}`, {
      revision: 1,
      objects: [mine.objects[0]!, stolen],
    })
    expect(response.status).toBe(409)
  })

  it('adds a STEP model that waits for the worker before the plate can slice', async () => {
    const draft = await newDraft()
    const form = new FormData()
    form.append('file', new File([stepFile()], `${PREFIX}bracket.step`))
    form.append('revision', '1')
    form.append('object', JSON.stringify(placed(60, 60)))
    const added = await app.request(`/api/print/drafts/${draft.id}/models`, {
      method: 'POST',
      body: form,
      headers: { cookie: memberCookie },
    })
    expect(added.status).toBe(200)
    const body = (await added.json()) as Draft
    expect(body.models.map((model) => model.meshState)).toEqual(['READY', 'QUEUED'])
    expect(body.revision).toBe(2)

    const refused = await slice(body)
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({ error: expect.stringContaining('STEP') })
  })
})

describe('slicing', () => {
  it('queues one job with the plate frozen in it, and reuses it for the same plate', async () => {
    const draft = await newDraft()
    expect((await slice(draft)).status).toBe(200)
    const job = await prisma.printSlice.findUniqueOrThrow({
      where: { requestId: draft.id },
    })
    expect(job.state).toBe('QUEUED')
    expect(job.spec).toMatchObject({
      material: 'PLA',
      preset: 'STANDARD',
      objects: [{ x: 128, y: 128 }],
    })

    expect((await slice(draft)).status).toBe(200)
    const again = await prisma.printSlice.findUniqueOrThrow({
      where: { requestId: draft.id },
    })
    expect(again.requestedAt).toEqual(job.requestedAt)
  })

  it('makes a READY slice stale on an edit, and current again when the edit is undone', async () => {
    const draft = await slicedDraft()
    expect(draft.slice).toMatchObject({
      state: 'READY',
      current: true,
      estimatedGrams: 36.2,
    })

    const moved = { ...draft.objects[0]!, x: 100 }
    const edited = (await (
      await send('PATCH', `/api/print/drafts/${draft.id}`, {
        revision: draft.revision,
        objects: [moved],
      })
    ).json()) as Draft
    expect(edited.slice?.current).toBe(false)
    expect((await submit(edited)).status).toBe(409)

    const back = (await (
      await send('PATCH', `/api/print/drafts/${draft.id}`, {
        revision: edited.revision,
        objects: [draft.objects[0]!],
      })
    ).json()) as Draft
    expect(back.slice?.current).toBe(true)
  })

  it('refuses while another of the member’s plates is slicing', async () => {
    const first = await newDraft()
    const second = await newDraft()
    expect((await slice(first)).status).toBe(200)
    expect((await slice(second)).status).toBe(409)
  })

  it('counts presses against the hourly budget', async () => {
    env.PRINT_SLICES_PER_HOUR = 1
    const draft = await newDraft()
    expect((await slice(draft)).status).toBe(200)
    await finishSlice(draft.id)
    const edited = (await (
      await send('PATCH', `/api/print/drafts/${draft.id}`, { revision: 1, preset: 'Q' })
    ).json()) as Draft
    expect((await slice(edited)).status).toBe(429)
  })

  it('refuses when no worker has been heard from', async () => {
    const live = await prisma.slicerWorker.count({
      where: { id: { not: WORKER }, seenAt: { gte: new Date(Date.now() - 90_000) } },
    })
    // A real worker heartbeating into this database would answer for itself.
    if (live > 0) return
    await prisma.slicerWorker.deleteMany({ where: { id: WORKER } })
    const draft = await newDraft()
    expect((await slice(draft)).status).toBe(503)
  })

  it('serves the preview to its owner only', async () => {
    const draft = await slicedDraft()
    const own = await app.request(`/api/print/drafts/${draft.id}/preview`, {
      headers: { cookie: memberCookie },
    })
    expect(own.status).toBe(200)
    expect(new Uint8Array(await own.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
    const other = await app.request(`/api/print/drafts/${draft.id}/preview`, {
      headers: { cookie: otherCookie },
    })
    expect(other.status).toBe(404)
  })
})

describe('submitting', () => {
  it('needs a current slice', async () => {
    const draft = await newDraft()
    expect((await submit(draft)).status).toBe(409)
  })

  it('sends the plate to the queue with its estimate, once', async () => {
    const draft = await slicedDraft()
    const response = await submit(draft, { projectId, notes: 'Black please' })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      status: 'PENDING',
      estimatedGrams: 36.2,
      estimatedSeconds: 3_600,
      notes: 'Black please',
      project: { id: projectId },
    })
    const row = await prisma.printRequest.findUniqueOrThrow({ where: { id: draft.id } })
    expect(row.submittedAt).not.toBeNull()
    expect(notifyOfficers).toHaveBeenCalledTimes(1)
    expect(vi.mocked(notifyOfficers).mock.calls[0]![0]).toContain('about 37 g')

    const queue = (await (
      await app.request('/api/officer/print-queue', {
        headers: { cookie: officerCookie },
      })
    ).json()) as { id: string; sliceFile: unknown; preset: string }[]
    expect(queue.find((item) => item.id === draft.id)).toMatchObject({
      preset: 'STANDARD',
      sliceFile: { layers: 100 },
    })

    // Not a draft any more, so it can't be sent twice.
    expect((await submit({ ...draft, revision: row.revision })).status).toBe(404)
  })

  it('refuses a project the member isn’t on', async () => {
    const draft = await slicedDraft()
    const other = await prisma.project.create({
      data: {
        slug: `${PREFIX}other`,
        title: 'Not Theirs',
        termYear: 2035,
        termSeason: Season.FALL,
      },
    })
    expect((await submit(draft, { projectId: other.id })).status).toBe(403)
  })

  it('can be taken back to edit until an officer starts it', async () => {
    const draft = await slicedDraft()
    await submit(draft)
    const back = await send('POST', `/api/print/${draft.id}/unsubmit`, {})
    expect(back.status).toBe(200)
    expect(await back.json()).toMatchObject({ status: 'DRAFT' })

    const again = await read(draft.id)
    await submit(again)
    await settle(draft.id, { status: 'PRINTING' })
    expect((await send('POST', `/api/print/${draft.id}/unsubmit`, {})).status).toBe(409)
  })
})

describe('the officer’s side', () => {
  it('downloads the .3mf, for officers only', async () => {
    const draft = await slicedDraft()
    // A draft's file is its owner's business.
    expect(
      (
        await app.request(`/api/officer/print/${draft.id}/slice-file`, {
          headers: { cookie: officerCookie },
        })
      ).status,
    ).toBe(404)

    await submit(draft)
    const file = await app.request(`/api/officer/print/${draft.id}/slice-file`, {
      headers: { cookie: officerCookie },
    })
    expect(file.status).toBe(200)
    expect(file.headers.get('content-type')).toBe('model/3mf')
    expect(file.headers.get('content-disposition')).toMatch(
      /^attachment; filename=".+\.3mf"$/,
    )
    expect(
      (
        await app.request(`/api/officer/print/${draft.id}/slice-file`, {
          headers: { cookie: memberCookie },
        })
      ).status,
    ).toBe(403)
  })

  it('charges the estimate, rounded up, when MARK DONE names no figure', async () => {
    const draft = await slicedDraft()
    await submit(draft)
    const files = await prisma.printSlice.findUniqueOrThrow({
      where: { requestId: draft.id },
    })
    const modelFile = (
      await prisma.printModel.findFirstOrThrow({ where: { requestId: draft.id } })
    ).fileId!

    const done = await settle(draft.id, { status: 'DONE' })
    expect(done.status).toBe(200)
    expect(await done.json()).toMatchObject({ status: 'DONE', gramsUsed: 37 })

    // Every byte goes with the settle; the row stays as the record.
    const gone = await prisma.storedFile.count({
      where: { id: { in: [modelFile, files.outputFileId!, files.previewFileId!] } },
    })
    expect(gone).toBe(0)
    const allowance = (await (
      await app.request('/api/me/print-allowance', { headers: { cookie: memberCookie } })
    ).json()) as { usedGrams: number }
    expect(allowance.usedGrams).toBe(37)
  })

  it('takes the officer’s figure over the estimate', async () => {
    const draft = await slicedDraft()
    await submit(draft)
    const done = await settle(draft.id, { status: 'DONE', gramsUsed: 52 })
    expect(await done.json()).toMatchObject({ gramsUsed: 52 })
  })

  it('still stops a personal print past the allowance unless told to go over', async () => {
    const draft = await newDraft()
    await slice(draft)
    await finishSlice(draft.id, env.PERSONAL_PRINT_GRAMS + 10)
    await submit(await read(draft.id))
    expect((await settle(draft.id, { status: 'DONE' })).status).toBe(409)
    expect((await settle(draft.id, { status: 'DONE', overAllowance: true })).status).toBe(
      200,
    )
  })

  it('refuses settings corrections on a plate its owner sliced', async () => {
    const draft = await slicedDraft()
    await submit(draft)
    const response = await settle(draft.id, {
      status: 'DONE',
      printed: {
        process: 'FDM',
        material: 'PETG',
        infillPattern: 'GRID',
        infillDensity: 20,
      },
    })
    expect(response.status).toBe(400)
  })
})

describe('when drafts go', () => {
  it('discards a draft with its files', async () => {
    const draft = await slicedDraft()
    const response = await send('DELETE', `/api/print/drafts/${draft.id}`, {})
    expect(response.status).toBe(200)
    expect(await prisma.printRequest.findUnique({ where: { id: draft.id } })).toBeNull()
    expect(
      await prisma.storedFile.count({ where: { originalName: { startsWith: PREFIX } } }),
    ).toBe(0)
  })

  it('expires drafts left alone, and leaves ones still in use', async () => {
    const old = await newDraft()
    const fresh = await newDraft()
    await prisma.printRequest.update({
      where: { id: old.id },
      data: { createdAt: new Date('1999-12-01'), draftActiveAt: new Date('1999-12-01') },
    })
    await prisma.printRequest.update({
      where: { id: fresh.id },
      data: { createdAt: new Date('1999-12-30'), draftActiveAt: new Date('1999-12-31') },
    })

    // A 2000 clock, so no real draft is old enough to be in the window.
    await sweepPrintDrafts(new Date('2000-01-01T12:00:00'))
    expect(await prisma.printRequest.findUnique({ where: { id: old.id } })).toBeNull()
    expect(
      await prisma.printRequest.findUnique({ where: { id: fresh.id } }),
    ).not.toBeNull()
    expect(
      await prisma.storedFile.count({
        where: { createdById: memberId, kind: FileKind.PRINT_MODEL },
      }),
    ).toBe(1)
  })

  it('keeps a submitted request out of the sweep', async () => {
    const draft = await slicedDraft()
    await submit(draft)
    await prisma.printRequest.update({
      where: { id: draft.id },
      data: { createdAt: new Date('1999-12-01') },
    })
    await sweepPrintDrafts(new Date('2000-01-01T12:00:00'))
    expect(
      (await prisma.printRequest.findUniqueOrThrow({ where: { id: draft.id } })).status,
    ).toBe(PrintRequestStatus.PENDING)
  })
})
