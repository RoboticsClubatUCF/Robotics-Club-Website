import { strToU8, zipSync } from 'fflate'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../../app.js'
import { createSession } from '../../auth/session.js'
import { prisma } from '../../core/db.js'
import { env } from '../../core/env.js'
import {
  PrintRequestStatus,
  Season,
  SlicerJobState,
  SlicerProfileKind,
  UserRole,
} from '../../generated/prisma/enums.js'

/**
 * The slicer profiles desk. Nothing here resolves a profile: that's the worker, and
 * `sliceSmoke.ts` runs it against Orca's real stock profiles. These cases check what the API
 * keeps, refuses and hands the worker.
 *
 * Every preset is named with the prefix and deleted by it; the club's own profiles share the
 * table, so assertions only look at the suite's rows.
 */

const PREFIX = 'test-profiles-'
const PAID_UP = new Date('2035-12-31T23:59:59')

const clearWindows = () =>
  prisma.rateLimit.deleteMany({
    where: { OR: ['officer:', 'profiles:'].map((key) => ({ key: { startsWith: key } })) },
  })

async function clearRows() {
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
  await prisma.slicerProfile.deleteMany({ where: { name: { startsWith: PREFIX } } })
}

let officerCookie: string
let memberCookie: string
let memberId: string

beforeEach(async () => {
  await clearWindows()
  await clearRows()
  const make = (name: string, role: UserRole) =>
    prisma.user.create({
      data: {
        fullName: `Profiles ${name}`,
        email: `${PREFIX}${name}@ucf.edu`,
        role,
        duesPaidThrough: PAID_UP,
      },
    })
  const officer = await make('officer', UserRole.OFFICER)
  const member = await make('member', UserRole.MEMBER)
  memberId = member.id
  officerCookie = `${env.SESSION_COOKIE_NAME}=${(await createSession(officer.id)).token}`
  memberCookie = `${env.SESSION_COOKIE_NAME}=${(await createSession(member.id)).token}`
})

afterAll(async () => {
  await clearWindows()
  await clearRows()
  await prisma.$disconnect()
})

const preset = (name: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ name: `${PREFIX}${name}`, inherits: 'Some Stock Preset', from: 'User', ...extra })

/** An `.orca_printer` bundle the way desktop Orca writes one. */
function printerBundle(printer = 'CC1', processes = ['Standard', 'Fine'], filaments = ['PLA']) {
  const files: Record<string, Uint8Array> = {
    [`printer/${printer}.json`]: strToU8(preset(printer, { printer_settings_id: `${PREFIX}${printer}` })),
  }
  for (const name of processes) {
    files[`process/${name}.json`] = strToU8(preset(name, { print_settings_id: `${PREFIX}${name}` }))
  }
  for (const name of filaments) {
    files[`filament/${name}.json`] = strToU8(preset(name, { filament_settings_id: [`${PREFIX}${name}`] }))
  }
  files['bundle_structure.json'] = strToU8(
    JSON.stringify({
      bundle_type: 'printer config bundle',
      printer_config: [`printer/${printer}.json`],
      process_config: processes.map((name) => `process/${name}.json`),
      filament_config: filaments.map((name) => `filament/${name}.json`),
    }),
  )
  return zipSync(files)
}

const fileForm = (bytes: Uint8Array, name: string, fields: Record<string, string> = {}) => {
  const form = new FormData()
  form.append('file', new File([new Uint8Array(bytes)], name))
  for (const [key, value] of Object.entries(fields)) form.append(key, value)
  return form
}

const post = (path: string, form: FormData, cookie = officerCookie) =>
  app.request(`/api/officer/slicer-profiles${path}`, { method: 'POST', body: form, headers: { cookie } })

const send = (method: string, path: string, body: unknown, cookie = officerCookie) =>
  app.request(`/api/officer/slicer-profiles${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(body),
  })

interface DeskProfile {
  id: string
  kind: string
  name: string
  label: string
  description: string | null
  offered: boolean
  state: string
  sourceFile: string
  uploadedBy: string | null
  uses: { drafts: number; sent: number }
}
interface Desk {
  printers: (DeskProfile & { processes: DeskProfile[] })[]
  filaments: (DeskProfile & { fits: string[] | null })[]
}

const ours = (desk: Desk) => ({
  printers: desk.printers.filter((p) => p.name.startsWith(PREFIX)),
  filaments: desk.filaments.filter((f) => f.name.startsWith(PREFIX)),
})

async function addBundle(fields: Record<string, string>, bundle = printerBundle()) {
  return post('', fileForm(bundle, 'CC1.orca_printer', fields))
}

const ALL = JSON.stringify([
  'printer/CC1.json',
  'process/Standard.json',
  'process/Fine.json',
  'filament/PLA.json',
])

describe('who may use it', () => {
  it('is officers only', async () => {
    expect((await app.request('/api/officer/slicer-profiles', { headers: { cookie: memberCookie } })).status).toBe(403)
    expect((await post('/inspect', fileForm(printerBundle(), 'x.orca_printer'), memberCookie)).status).toBe(403)
    expect((await send('DELETE', '/x', {}, memberCookie)).status).toBe(403)
  })
})

describe('uploading', () => {
  it('lists what is in an export without saving anything', async () => {
    const response = await post('/inspect', fileForm(printerBundle(), 'CC1.orca_printer'))
    expect(response.status).toBe(200)
    const body = (await response.json()) as { presets: { entry: string; kind: string; name: string }[] }
    expect(body.presets.map((p) => [p.kind, p.name])).toEqual([
      ['FILAMENT', `${PREFIX}PLA`],
      ['PRINTER', `${PREFIX}CC1`],
      ['PROCESS', `${PREFIX}Fine`],
      ['PROCESS', `${PREFIX}Standard`],
    ])
    expect(await prisma.slicerProfile.count({ where: { name: { startsWith: PREFIX } } })).toBe(0)
  })

  it('matches a bundle’s processes against its printer when that printer is already here', async () => {
    await addBundle({ entries: JSON.stringify(['printer/CC1.json', 'process/Standard.json']) })
    const printer = await prisma.slicerProfile.findFirstOrThrow({ where: { name: `${PREFIX}CC1` } })
    const response = await post('/inspect', fileForm(printerBundle(), 'CC1.orca_printer'))
    const body = (await response.json()) as {
      printer: { id: string } | null
      presets: { name: string; existing: { id: string } | null }[]
    }
    expect(body.printer?.id).toBe(printer.id)
    const existing = (name: string) => body.presets.find((p) => p.name === `${PREFIX}${name}`)!.existing
    expect(existing('CC1')).not.toBeNull()
    expect(existing('Standard')).not.toBeNull()
    expect(existing('Fine')).toBeNull()
  })

  it('matches processes against the printer they are being added to', async () => {
    await addBundle({ entries: JSON.stringify(['printer/CC1.json', 'process/Fine.json']) })
    const printer = await prisma.slicerProfile.findFirstOrThrow({ where: { name: `${PREFIX}CC1` } })
    const other = printerBundle('MK4', ['Fine', 'Standard'], [])
    const response = await post('/inspect', fileForm(other, 'MK4.orca_printer', { printerId: printer.id }))
    const body = (await response.json()) as { printer: { id: string } | null; presets: { name: string; existing: unknown }[] }
    expect(body.printer?.id).toBe(printer.id)
    expect(body.presets.find((p) => p.name === `${PREFIX}Fine`)?.existing).not.toBeNull()
    expect(body.presets.find((p) => p.name === `${PREFIX}Standard`)?.existing).toBeNull()
  })

  it('adds a printer with its processes and a filament, queued for the worker', async () => {
    const response = await addBundle({ entries: ALL })
    expect(response.status).toBe(201)
    const desk = ours((await response.json()) as Desk)
    expect(desk.printers).toHaveLength(1)
    const printer = desk.printers[0]!
    expect(printer).toMatchObject({
      label: `${PREFIX}CC1`,
      state: 'QUEUED',
      sourceFile: 'CC1.orca_printer: printer/CC1.json',
      uploadedBy: 'Profiles officer',
    })
    expect(printer.processes.map((p) => p.name)).toEqual([`${PREFIX}Standard`, `${PREFIX}Fine`])
    expect(desk.filaments.map((f) => f.name)).toEqual([`${PREFIX}PLA`])

    const row = await prisma.slicerProfile.findFirstOrThrow({ where: { name: `${PREFIX}Fine` } })
    expect(row.printerId).toBe(printer.id)
    expect(JSON.parse(row.source)).toMatchObject({ inherits: 'Some Stock Preset' })
  })

  it('takes one preset’s .json on its own', async () => {
    const response = await post(
      '',
      fileForm(strToU8(preset('Silk', { filament_type: ['PLA'] })), 'Silk.json', {
        entries: JSON.stringify(['Silk.json']),
      }),
    )
    expect(response.status).toBe(201)
    const desk = ours((await response.json()) as Desk)
    expect(desk.filaments[0]).toMatchObject({ name: `${PREFIX}Silk`, sourceFile: 'Silk.json' })
  })

  it('puts processes on a printer that is already set up', async () => {
    await addBundle({ entries: JSON.stringify(['printer/CC1.json', 'process/Standard.json']) })
    const printer = await prisma.slicerProfile.findFirstOrThrow({ where: { name: `${PREFIX}CC1` } })
    const response = await addBundle({
      entries: JSON.stringify(['process/Fine.json']),
      printerId: printer.id,
    })
    expect(response.status).toBe(201)
    const fine = await prisma.slicerProfile.findFirstOrThrow({ where: { name: `${PREFIX}Fine` } })
    expect(fine).toMatchObject({ printerId: printer.id, position: 1 })
  })

  it.each([
    ['nothing picked', { entries: '[]' }, 400],
    ['an entry the file doesn’t have', { entries: JSON.stringify(['process/Nope.json']) }, 400],
    ['a process with no printer', { entries: JSON.stringify(['process/Fine.json']) }, 400],
  ])('refuses %s', async (_case, fields, status) => {
    expect((await addBundle(fields)).status).toBe(status)
  })

  it('refuses a file that isn’t an Orca export', async () => {
    const response = await post('/inspect', fileForm(strToU8('%PDF-1.4'), 'x.json'))
    expect(response.status).toBe(400)
    const nameless = await post('/inspect', fileForm(strToU8('{"inherits":"x"}'), 'x.json'))
    expect(nameless.status).toBe(400)
  })

  it('refuses a name that’s taken, and says to replace it', async () => {
    expect((await addBundle({ entries: JSON.stringify(['filament/PLA.json']) })).status).toBe(201)
    const again = await addBundle({ entries: JSON.stringify(['filament/PLA.json']) })
    expect(again.status).toBe(409)
    expect(((await again.json()) as { error: string }).error).toContain('Replace that one')
  })
})

describe('editing', () => {
  async function setUp() {
    const desk = ours((await (await addBundle({ entries: ALL })).json()) as Desk)
    return { printer: desk.printers[0]!, filament: desk.filaments[0]! }
  }

  it('renames, describes and hides a profile', async () => {
    const { filament } = await setUp()
    const response = await send('PATCH', `/${filament.id}`, {
      label: 'PLA',
      description: 'The everyday one.',
      offered: false,
    })
    expect(response.status).toBe(200)
    expect(ours((await response.json()) as Desk).filaments[0]).toMatchObject({
      label: 'PLA',
      description: 'The everyday one.',
      offered: false,
    })
    // An emptied description is no description.
    await send('PATCH', `/${filament.id}`, { description: '' })
    expect((await prisma.slicerProfile.findUniqueOrThrow({ where: { id: filament.id } })).description).toBeNull()
    expect((await send('PATCH', `/${filament.id}`, { label: '  ' })).status).toBe(400)
  })

  it('reorders a printer’s processes, and only the whole list', async () => {
    const { printer } = await setUp()
    const [standard, fine] = printer.processes
    const partial = await send('PATCH', '/order', { ids: [fine!.id] })
    expect(partial.status).toBe(409)
    const response = await send('PATCH', '/order', { ids: [fine!.id, standard!.id] })
    expect(response.status).toBe(200)
    expect(ours((await response.json()) as Desk).printers[0]!.processes.map((p) => p.id)).toEqual([
      fine!.id,
      standard!.id,
    ])
  })

  it('replaces a profile’s file and queues it again, with a printer’s processes', async () => {
    const { printer } = await setUp()
    await prisma.slicerProfile.updateMany({
      where: { name: { startsWith: PREFIX } },
      data: { state: SlicerJobState.READY, sha256: 'old', resolved: '{}' },
    })
    const response = await post(
      `/${printer.id}/replace`,
      fileForm(printerBundle('CC1', [], []), 'CC1 v2.orca_printer'),
    )
    expect(response.status).toBe(200)
    const rows = await prisma.slicerProfile.findMany({ where: { name: { startsWith: PREFIX } } })
    const byName = (name: string) => rows.find((row) => row.name === `${PREFIX}${name}`)!
    expect(byName('CC1')).toMatchObject({ state: 'QUEUED', sha256: null, resolved: null })
    expect(byName('CC1').sourceFile).toBe('CC1 v2.orca_printer: printer/CC1.json')
    expect(byName('Fine')).toMatchObject({ state: 'QUEUED', sha256: null })
    // A filament isn't the printer's.
    expect(byName('PLA')).toMatchObject({ state: 'READY', sha256: 'old' })
  })

  it('refuses a replacement of another kind', async () => {
    const { filament } = await setUp()
    const response = await post(
      `/${filament.id}/replace`,
      fileForm(printerBundle('Other', [], []), 'Other.orca_printer'),
    )
    expect(response.status).toBe(400)
  })
})

describe('deleting', () => {
  it('takes a printer’s processes with it and leaves drafts asking for another', async () => {
    const desk = ours((await (await addBundle({ entries: ALL })).json()) as Desk)
    const printer = desk.printers[0]!
    const draft = await prisma.printRequest.create({
      data: {
        userId: memberId,
        status: PrintRequestStatus.DRAFT,
        fileName: `${PREFIX}plate`,
        fileSize: 1,
        termYear: 2035,
        termSeason: Season.FALL,
        printerProfileId: printer.id,
        processProfileId: printer.processes[0]!.id,
        filamentProfileId: desk.filaments[0]!.id,
        slicedWith: { printer: 'CC1', process: 'Standard', filament: 'PLA' },
      },
    })

    const before = ours((await (await app.request('/api/officer/slicer-profiles', { headers: { cookie: officerCookie } })).json()) as Desk)
    expect(before.printers[0]!.uses).toEqual({ drafts: 1, sent: 0 })

    expect((await send('DELETE', `/${printer.id}`, {})).status).toBe(200)
    expect(await prisma.slicerProfile.count({ where: { printerId: printer.id } })).toBe(0)
    const after = await prisma.printRequest.findUniqueOrThrow({ where: { id: draft.id } })
    expect(after).toMatchObject({ printerProfileId: null, processProfileId: null })
    expect(after.filamentProfileId).toBe(desk.filaments[0]!.id)
    expect(after.slicedWith).toEqual({ printer: 'CC1', process: 'Standard', filament: 'PLA' })

    expect((await send('DELETE', `/${printer.id}`, {})).status).toBe(404)
  })
})

describe('the worker’s queue', () => {
  it('hands out a printer before its processes, and a process only once its printer is READY', async () => {
    const { claimProfile } = await import('../../printing/profileJobs.js')
    // Other queued rows in the table would be claimed too, so this runs only on a quiet queue.
    const others = await prisma.slicerProfile.count({
      where: { state: { in: [SlicerJobState.QUEUED, SlicerJobState.RUNNING] }, name: { not: { startsWith: PREFIX } } },
    })
    if (others > 0) return
    await addBundle({ entries: JSON.stringify(['process/Fine.json', 'printer/CC1.json']) })
    const first = await claimProfile()
    expect(first).toMatchObject({ kind: SlicerProfileKind.PRINTER, name: `${PREFIX}CC1` })
    // The process waits while its printer is still being resolved.
    expect(await claimProfile()).toBeNull()
    await prisma.slicerProfile.update({ where: { id: first!.id }, data: { state: SlicerJobState.READY } })
    expect(await claimProfile()).toMatchObject({ kind: SlicerProfileKind.PROCESS, name: `${PREFIX}Fine` })
  })
})
