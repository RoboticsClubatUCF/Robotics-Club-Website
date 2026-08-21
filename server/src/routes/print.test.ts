import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../app.js'
import { prisma } from '../db.js'
import { env } from '../env.js'
import {
  PrintRequestStatus,
  Season,
  UserRole,
} from '../generated/prisma/enums.js'
import { currentTerm } from '../semester.js'
import { createSession } from '../session.js'

/**
 * Print requests, against the live database.
 *
 * Discord is stubbed at the module boundary, and not optionally: the dev
 * database holds real officers with real Discord ids, and an unstubbed run
 * of this suite would DM them about fixture uploads. The stub answers
 * `refused` on purpose — the property under test is that a delivery failing
 * never fails the member's upload.
 *
 * The storage rule gets its teeth checked here: DONE and REJECTED delete the
 * `stored_files` row in the same transaction, while the request row keeps the
 * name and size as history.
 */

vi.mock('../discord.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../discord.js')>()),
  discordConfigured: true,
  sendDirectMessage: vi.fn(() =>
    Promise.resolve({ status: 'refused' as const, reason: 'privacy settings' }),
  ),
}))

const PREFIX = 'test-print-'
const email = (name: string) => `${PREFIX}${name}@ucf.edu`

const clearWindows = () =>
  prisma.rateLimit.deleteMany({
    where: {
      OR: [{ key: { startsWith: 'print:' } }, { key: { startsWith: 'officer:' } }],
    },
  })

const clearRows = async () => {
  // Requests cascade from their users; stray files are keyed by uploader.
  const users = await prisma.user.findMany({
    where: { email: { startsWith: PREFIX } },
    select: { id: true },
  })
  await prisma.storedFile.deleteMany({
    where: { createdById: { in: users.map((u) => u.id) } },
  })
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
  // Same prefix, different column: the club's real projects must survive this.
  await prisma.project.deleteMany({ where: { slug: { startsWith: PREFIX } } })
}

async function cookieFor(userId: string): Promise<string> {
  const { token } = await createSession(userId)
  return `${env.SESSION_COOKIE_NAME}=${token}`
}

let memberCookie: string
let otherCookie: string
let officerCookie: string
let memberId: string
/** A project the member is on, and one they are not. */
let myProjectId: string
let otherProjectId: string
/** The term a request made right now is stamped with. */
let term: { termYear: number; termSeason: Season }

/**
 * Paid up, and the suite is deterministic only because they are. Both routers
 * need current dues now — the club's line is that a lapsed account gets the
 * dues page and its own projects and nothing else — and whether *anybody* is
 * lapsed depends on the calendar, so fixtures with no date would pass all
 * summer and fail the week fall's trial closes. The lapsed case is covered in
 * `authz.test.ts`, which pins its clock for the same reason.
 */
const PAID_UP = new Date('2035-12-31T23:59:59')

beforeEach(async () => {
  await clearWindows()
  await clearRows()

  const [member, other, officer] = await Promise.all([
    prisma.user.create({
      data: {
        fullName: 'Print Member',
        email: email('member'),
        role: UserRole.MEMBER,
        duesPaidThrough: PAID_UP,
      },
    }),
    prisma.user.create({
      data: {
        fullName: 'Print Other',
        email: email('other'),
        role: UserRole.MEMBER,
        duesPaidThrough: PAID_UP,
      },
    }),
    prisma.user.create({
      data: {
        fullName: 'Print Officer',
        email: email('officer'),
        role: UserRole.OFFICER,
        duesPaidThrough: PAID_UP,
      },
    }),
  ])

  memberCookie = await cookieFor(member.id)
  otherCookie = await cookieFor(other.id)
  officerCookie = await cookieFor(officer.id)
  memberId = member.id

  const [mine, theirs] = await Promise.all([
    prisma.project.create({
      data: {
        slug: `${PREFIX}mine`,
        title: 'Print Fixture Rover',
        termYear: 2035,
        termSeason: Season.FALL,
        members: { create: { userId: member.id } },
      },
    }),
    prisma.project.create({
      data: {
        slug: `${PREFIX}theirs`,
        title: 'Print Fixture Blimp',
        termYear: 2035,
        termSeason: Season.FALL,
      },
    }),
  ])

  myProjectId = mine.id
  otherProjectId = theirs.id

  // Read from the same source the route stamps requests from, so a fixture
  // written by hand lands in the bucket the route will look in. Pinning a
  // literal here would put the two on different sides of a semester boundary
  // for a fortnight every August.
  const now = await currentTerm()
  term = { termYear: now.year, termSeason: now.season }
})

afterAll(async () => {
  await clearWindows()
  await clearRows()
  await prisma.$disconnect()
})

/** A tiny but structurally valid binary STL: 80-byte header, one triangle. */
function binaryStl(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(84 + 50)
  new DataView(bytes.buffer).setUint32(80, 1, true)
  return bytes
}

const asciiStl = () => new TextEncoder().encode('solid part\nendsolid part\n')
const stepFile = () => new TextEncoder().encode('ISO-10303-21;\nHEADER;\nENDSEC;\n')

/**
 * The fields beside the file. Defaults are a legal FDM combination, so a test
 * about something else says nothing about settings; anything set to
 * `undefined` is left off the body entirely, which is how the SLA cases prove
 * the infill fields are refused rather than merely ignored.
 */
type Fields = Record<string, string | number | undefined>

const DEFAULT_FIELDS: Fields = {
  process: 'FDM',
  material: 'PLA',
  infillPattern: 'GRID',
  infillDensity: 20,
}

// `Uint8Array<ArrayBuffer>`, not a bare `Uint8Array`: the default type
// parameter is `ArrayBufferLike`, which admits `SharedArrayBuffer`, and `File`
// will not take one of those.
function upload(
  cookie: string,
  name: string,
  bytes: Uint8Array<ArrayBuffer>,
  fields: Fields = {},
) {
  const form = new FormData()
  form.append('file', new File([bytes], name))

  for (const [key, value] of Object.entries({ ...DEFAULT_FIELDS, ...fields })) {
    if (value !== undefined) form.append(key, String(value))
  }

  return app.request('/api/print', { method: 'POST', body: form, headers: { cookie } })
}

/** Submit one and hand back its id, for the tests that only need it settled. */
async function submit(fields: Fields = {}, cookie = memberCookie) {
  const response = await upload(cookie, 'part.stl', asciiStl(), fields)
  const body = (await response.json()) as { id: string }

  return body.id
}

const allowance = async (cookie = memberCookie) => {
  const response = await app.request('/api/me/print-allowance', {
    headers: { cookie },
  })

  return (await response.json()) as {
    limitGrams: number
    usedGrams: number
    remainingGrams: number
  }
}

/** Grams already spent, written straight in — the officer route is what the
    tests below are about, and getting there through it every time would make
    each one depend on the last. */
const alreadySpent = (grams: number, at = term) =>
  prisma.printRequest.create({
    data: {
      userId: memberId,
      fileName: 'history.stl',
      fileSize: 10,
      status: PrintRequestStatus.DONE,
      gramsUsed: grams,
      termYear: at.termYear,
      termSeason: at.termSeason,
    },
  })

const patchStatus = (id: string, body: unknown, cookie = officerCookie) =>
  app.request(`/api/officer/print/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(body),
  })

describe('submitting', () => {
  it.each([
    ['an ASCII STL', 'bracket.stl', asciiStl()],
    ['a binary STL', 'bracket.stl', binaryStl()],
    ['a STEP file', 'bracket.step', stepFile()],
  ])('accepts %s, even with Discord refusing the DM', async (_kind, name, bytes) => {
    const response = await upload(memberCookie, name, bytes, {
      notes: 'Black if there is any',
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      fileName: name,
      fileSize: bytes.byteLength,
      status: 'PENDING',
    })
  })

  it('keeps the settings it was given, and defaults nothing about them', async () => {
    const response = await upload(memberCookie, 'part.stl', asciiStl(), {
      process: 'FDM',
      material: 'PETG',
      infillPattern: 'GYROID',
      infillDensity: 35,
    })

    expect(await response.json()).toMatchObject({
      process: 'FDM',
      material: 'PETG',
      infillPattern: 'GYROID',
      infillDensity: 35,
      // Null until an officer says otherwise — the row reads "as asked".
      printedMaterial: null,
      gramsUsed: null,
    })
  })

  /**
   * Resin has no infill, so the two fields are refused rather than stored as a
   * number nobody can act on. The stored nulls are the half that matters
   * downstream: `printedInfillPattern ?? infillPattern` must not produce a
   * pattern for a machine that has none.
   */
  it('takes an SLA request and leaves both infill columns null', async () => {
    const response = await upload(memberCookie, 'part.stl', asciiStl(), {
      process: 'SLA',
      material: 'ABS_LIKE_RESIN',
      infillPattern: undefined,
      infillDensity: undefined,
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      process: 'SLA',
      material: 'ABS_LIKE_RESIN',
      infillPattern: null,
      infillDensity: null,
    })
  })

  /**
   * How many is a field rather than a line in `notes`, because it is the one
   * thing in there that changes what the officer does. Defaulted rather than
   * required: one of a thing is what almost every request is.
   */
  it('takes a count, and defaults it to one', async () => {
    const four = await upload(memberCookie, 'part.stl', asciiStl(), { quantity: 4 })
    expect(await four.json()).toMatchObject({ quantity: 4 })

    const bare = await upload(memberCookie, 'part.stl', asciiStl(), {
      quantity: undefined,
    })
    expect(await bare.json()).toMatchObject({ quantity: 1 })
  })

  it.each([
    ['zero of something', 0],
    ['a negative count', -2],
    ['more than the cap', 51],
    ['a count that is not a number', 'lots'],
  ])('refuses %s', async (_case, quantity) => {
    const response = await upload(memberCookie, 'part.stl', asciiStl(), { quantity })

    expect(response.status).toBe(400)
  })

  it.each([
    ['resin on the filament printer', { process: 'FDM', material: 'ABS_LIKE_RESIN' }],
    ['filament in the resin printer', { process: 'SLA', material: 'PLA' }],
    [
      'infill on a resin print',
      { process: 'SLA', material: 'ABS_LIKE_RESIN', infillPattern: 'GRID' },
    ],
    ['an FDM print with no infill named', { infillPattern: undefined }],
  ])('refuses %s', async (_case, fields) => {
    const response = await upload(memberCookie, 'part.stl', asciiStl(), fields)

    expect(response.status).toBe(400)
  })

  it('refuses a PDF wearing an .stl extension, in words about file kinds', async () => {
    const response = await upload(
      memberCookie,
      'homework.stl',
      new TextEncoder().encode('%PDF-1.4 not a model'),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('.stl'),
    })
  })

  it('refuses extensions the printers cannot take at all', async () => {
    const response = await upload(memberCookie, 'notes.txt', asciiStl())

    expect(response.status).toBe(400)
  })

  it('refuses a file over the cap with a 413 that names the limit', async () => {
    const oversized = new Uint8Array(env.MAX_PRINT_FILE_MB * 1024 * 1024 + 128 * 1024)

    const response = await upload(memberCookie, 'huge.stl', oversized)

    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining(`${env.MAX_PRINT_FILE_MB} MB`),
    })
  })

  it('requires being signed in', async () => {
    const form = new FormData()
    form.append('file', new File([asciiStl()], 'part.stl'))

    const response = await app.request('/api/print', { method: 'POST', body: form })

    expect(response.status).toBe(401)
  })
})

/**
 * Who may ask at all.
 *
 * The printers run on club money, and the gate is now the same one everything
 * else uses: `duesPaidThrough` in the future, `ADMIN` aside. This used to be a
 * stricter check of its own that refused a `GUEST` whatever their standing —
 * necessary while the summer and the opening fortnight reported access for
 * everybody, and redundant the moment access became the date, since nothing can
 * set that date without promoting the account in the same transaction.
 *
 * The wording each refusal gets is `authz.test.ts`'s matrix, which pins its
 * clock; those assertions turn on which sentence, and the sentence turns on
 * whether a free window is running today. What is checked here is that this
 * router is behind the gate at all.
 */
describe('who may ask', () => {
  it('refuses an account with no cover', async () => {
    const lapsed = await prisma.user.create({
      data: {
        fullName: 'Print Lapsed',
        email: email('lapsed'),
        role: UserRole.MEMBER,
        duesPaidThrough: new Date('2024-01-15T00:00:00'),
      },
    })

    const response = await upload(await cookieFor(lapsed.id), 'part.stl', asciiStl())

    expect(response.status).toBe(403)
  })

  /**
   * **The role does not decide this any more, and that is the change.** A
   * `GUEST` carrying a live date is somebody an officer set a date on by hand,
   * and under one rule they are covered — the old check refused them for a
   * reason that no longer exists.
   */
  it('lets a covered account through whatever its role says', async () => {
    const guest = await prisma.user.create({
      data: {
        fullName: 'Print Covered Guest',
        email: email('guest'),
        role: UserRole.GUEST,
        duesPaidThrough: PAID_UP,
      },
    })

    const response = await upload(await cookieFor(guest.id), 'part.stl', asciiStl())

    expect(response.status).toBe(201)
  })

  it('shuts the whole router, not just the submit route', async () => {
    const id = await submit()
    const lapsed = await prisma.user.create({
      data: {
        fullName: 'Print Lapsed Two',
        email: email('lapsed2'),
        role: UserRole.MEMBER,
        duesPaidThrough: new Date('2024-01-15T00:00:00'),
      },
    })

    const response = await app.request(`/api/print/${id}`, {
      method: 'DELETE',
      headers: { cookie: await cookieFor(lapsed.id) },
    })

    expect(response.status).toBe(403)
  })
})

/**
 * Which budget a print comes out of, which is the whole of what `projectId`
 * decides. The club's rule: a personal print is capped, a project print is not
 * capped at all — honour system and the officer's discretion.
 */
describe('what a print is for', () => {
  it('accepts a project the member is on', async () => {
    const response = await upload(memberCookie, 'part.stl', asciiStl(), {
      projectId: myProjectId,
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      project: { title: 'Print Fixture Rover' },
    })
  })

  /**
   * The reason this is a plain membership lookup rather than
   * `requireProjectMember`: that helper waves officers through, and here it
   * would be a hole in the budget — an officer could bill any print to any
   * project and never touch their own allowance.
   */
  it.each([
    ['a member', () => memberCookie],
    ['an officer', () => officerCookie],
  ])('refuses a project %s is not on', async (_who, cookie) => {
    const response = await upload(cookie(), 'part.stl', asciiStl(), {
      projectId: otherProjectId,
    })

    expect(response.status).toBe(403)
  })

  it('stamps the term it was asked in, so the reset has something to compare', async () => {
    const id = await submit()

    expect(
      await prisma.printRequest.findUniqueOrThrow({ where: { id } }),
    ).toMatchObject(term)
  })
})

describe('the material allowance', () => {
  it('starts at the club figure and does not move until something is finished', async () => {
    expect(await allowance()).toMatchObject({
      limitGrams: env.PERSONAL_PRINT_GRAMS,
      usedGrams: 0,
      remainingGrams: env.PERSONAL_PRINT_GRAMS,
    })

    // Asked for, on a printer — but not printed. Nothing is spent yet.
    const id = await submit()
    await patchStatus(id, { status: 'PRINTING' })

    expect((await allowance()).usedGrams).toBe(0)
  })

  it('comes off the balance when a personal print is finished', async () => {
    const id = await submit()

    const done = await patchStatus(id, { status: 'DONE', gramsUsed: 60 })
    expect(done.status).toBe(200)

    expect(await allowance()).toMatchObject({
      usedGrams: 60,
      remainingGrams: env.PERSONAL_PRINT_GRAMS - 60,
    })
  })

  /** The club's decision, and the one that makes the honour system work. */
  it('leaves the balance alone for a project print', async () => {
    const id = await submit({ projectId: myProjectId })

    await patchStatus(id, { status: 'DONE', gramsUsed: 400 })

    expect((await allowance()).usedGrams).toBe(0)
  })

  it('needs a figure before a personal print can be marked done', async () => {
    const id = await submit()

    const response = await patchStatus(id, { status: 'DONE' })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('allowance'),
    })
  })

  it('takes no grams on a decline, because nothing was printed', async () => {
    const id = await submit()

    expect((await patchStatus(id, { status: 'REJECTED', gramsUsed: 20 })).status).toBe(
      400,
    )
    // And declining properly still works.
    expect((await patchStatus(id, { status: 'REJECTED' })).status).toBe(200)
  })

  /**
   * The reset. Written straight into the previous term rather than by moving
   * the clock: what is under test is that the sum is scoped by the request's
   * own stamp, and a fixture in the wrong bucket proves that far more directly
   * than a faked calendar would.
   */
  it('ignores grams spent in another term', async () => {
    await alreadySpent(450, {
      termYear: term.termYear - 1,
      termSeason: term.termSeason,
    })

    expect(await allowance()).toMatchObject({
      usedGrams: 0,
      remainingGrams: env.PERSONAL_PRINT_GRAMS,
    })
  })

  it('is one budget per person, not one shared between them', async () => {
    await alreadySpent(300)

    expect((await allowance()).usedGrams).toBe(300)
    expect((await allowance(otherCookie)).usedGrams).toBe(0)
  })

  it('counts resin and filament against the same 500', async () => {
    const filament = await submit()
    await patchStatus(filament, { status: 'DONE', gramsUsed: 100 })

    const resin = await submit({
      process: 'SLA',
      material: 'ABS_LIKE_RESIN',
      infillPattern: undefined,
      infillDensity: undefined,
    })
    await patchStatus(resin, { status: 'DONE', gramsUsed: 50 })

    expect((await allowance()).usedGrams).toBe(150)
  })
})

describe('going over the allowance', () => {
  /** 40 g asked for against 20 g left. */
  const nearlySpent = async () => {
    await alreadySpent(env.PERSONAL_PRINT_GRAMS - 20)
    return submit()
  }

  it('refuses, and the refusal names both numbers', async () => {
    const id = await nearlySpent()

    const response = await patchStatus(id, { status: 'DONE', gramsUsed: 40 })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('20 g past'),
    })
    // Refused means refused: the request is untouched and still printable.
    expect(
      await prisma.printRequest.findUniqueOrThrow({ where: { id } }),
    ).toMatchObject({ status: PrintRequestStatus.PENDING, gramsUsed: null })
  })

  /**
   * The officer is the one at the printer, so the cap is theirs to go past
   * deliberately. The balance is then allowed to read negative — clamping it
   * at zero would hide the very case this exists for.
   */
  it('goes through with the override, and the balance goes negative', async () => {
    const id = await nearlySpent()

    const response = await patchStatus(id, {
      status: 'DONE',
      gramsUsed: 40,
      overAllowance: true,
    })

    expect(response.status).toBe(200)
    expect(await allowance()).toMatchObject({
      usedGrams: env.PERSONAL_PRINT_GRAMS + 20,
      remainingGrams: -20,
    })
  })

  it('never applies to a project print, however big', async () => {
    await alreadySpent(env.PERSONAL_PRINT_GRAMS - 20)
    const id = await submit({ projectId: myProjectId })

    const response = await patchStatus(id, { status: 'DONE', gramsUsed: 2_000 })

    expect(response.status).toBe(200)
  })
})

describe('the stored file', () => {
  it('downloads for its owner and officers, and for nobody else', async () => {
    const created = await upload(memberCookie, 'part.stl', asciiStl())
    const { id } = (await created.json()) as { id: string }
    const { fileId } = (await prisma.printRequest.findUniqueOrThrow({
      where: { id },
      select: { fileId: true },
    })) as { fileId: string }

    const anonymous = await app.request(`/api/files/${fileId}`)
    expect(anonymous.status).toBe(401)

    const stranger = await app.request(`/api/files/${fileId}`, {
      headers: { cookie: otherCookie },
    })
    expect(stranger.status).toBe(403)

    const owner = await app.request(`/api/files/${fileId}`, {
      headers: { cookie: memberCookie },
    })
    expect(owner.status).toBe(200)
    expect(owner.headers.get('Content-Disposition')).toContain('part.stl')
    expect(owner.headers.get('Cache-Control')).toContain('no-store')

    const officer = await app.request(`/api/files/${fileId}`, {
      headers: { cookie: officerCookie },
    })
    expect(officer.status).toBe(200)
  })
})

describe('the officer queue', () => {
  it('is officer-only, and lists live work oldest first', async () => {
    await upload(memberCookie, 'first.stl', asciiStl())
    await upload(memberCookie, 'second.stl', binaryStl())

    const denied = await app.request('/api/officer/print-queue', {
      headers: { cookie: memberCookie },
    })
    expect(denied.status).toBe(403)

    const queue = await app.request('/api/officer/print-queue', {
      headers: { cookie: officerCookie },
    })
    const names = ((await queue.json()) as { fileName: string }[])
      .map((r) => r.fileName)
      .filter((name) => name.endsWith('.stl'))
    expect(names.indexOf('first.stl')).toBeLessThan(names.indexOf('second.stl'))
  })

  /**
   * `?all=1` is what lets the browser's search box on LIVE find a print that
   * has already been done or declined — it cannot search rows it was never
   * sent. History also comes back newest-first, because `take` cuts at a
   * hundred and the oldest hundred is the least useful hundred there are.
   */
  it('answers with every status on ?all=1, newest first', async () => {
    const older = await submit()
    const newer = await submit()
    await patchStatus(older, { status: 'REJECTED' })

    const live = (await (
      await app.request('/api/officer/print-queue', {
        headers: { cookie: officerCookie },
      })
    ).json()) as { id: string }[]
    expect(live.find((row) => row.id === older)).toBeUndefined()

    const all = (await (
      await app.request('/api/officer/print-queue?all=1', {
        headers: { cookie: officerCookie },
      })
    ).json()) as { id: string }[]

    const mine = all
      .map((row) => row.id)
      .filter((id) => id === older || id === newer)
    expect(mine).toEqual([newer, older])
  })

  /**
   * The storage rule, end to end: settling a request deletes the bytes in the
   * same transaction, and the request row keeps the story.
   */
  it('DONE deletes the file and keeps the record', async () => {
    const created = await upload(memberCookie, 'part.stl', asciiStl(), {
      notes: 'Two of them if that is not a lot to ask',
    })
    const { id } = (await created.json()) as { id: string }
    const before = await prisma.printRequest.findUniqueOrThrow({
      where: { id },
      select: { fileId: true },
    })

    const printing = await patchStatus(id, { status: 'PRINTING' })
    expect(printing.status).toBe(200)
    // Still on the printer — the file stays until the job settles.
    expect(await prisma.storedFile.count({ where: { id: before.fileId! } })).toBe(1)

    const done = await patchStatus(id, {
      status: 'DONE',
      gramsUsed: 24,
      officerNote: 'On the shelf in the lab.',
    })
    expect(done.status).toBe(200)

    expect(await prisma.storedFile.count({ where: { id: before.fileId! } })).toBe(0)

    const after = await prisma.printRequest.findUniqueOrThrow({ where: { id } })
    expect(after).toMatchObject({
      status: PrintRequestStatus.DONE,
      fileId: null,
      fileName: 'part.stl',
      fileSize: asciiStl().byteLength,
      officerNote: 'On the shelf in the lab.',
    })
    expect(after.decidedById).not.toBeNull()
  })

  /**
   * "Which officer approved this" has to include the one who put it on the
   * printer, not only whoever settled it — which is what the column used to
   * record.
   */
  it('records the officer on every move, not only the last one', async () => {
    const id = await submit()

    await patchStatus(id, { status: 'PRINTING' })

    const moved = await prisma.printRequest.findUniqueOrThrow({ where: { id } })
    expect(moved.decidedById).not.toBeNull()
  })

  /**
   * `REJECTED` is two events wearing one status — a request nobody started
   * being declined, and a print already running being stopped — and this
   * column is the only thing that tells them apart. The dashboard reads it to
   * name the action, so a decline that looked like a cancellation would put a
   * false sentence in front of the member who asked.
   */
  it('stamps when a print went on a printer, and only then', async () => {
    const declined = await submit()
    await patchStatus(declined, { status: 'REJECTED' })
    expect(
      (await prisma.printRequest.findUniqueOrThrow({ where: { id: declined } }))
        .startedAt,
    ).toBeNull()

    const cancelled = await submit()
    await patchStatus(cancelled, { status: 'PRINTING' })
    const started = (
      await prisma.printRequest.findUniqueOrThrow({ where: { id: cancelled } })
    ).startedAt
    expect(started).not.toBeNull()

    await patchStatus(cancelled, { status: 'REJECTED' })
    const after = await prisma.printRequest.findUniqueOrThrow({
      where: { id: cancelled },
    })
    // Survives the cancellation, or the cancellation could not be told from a
    // decline the moment it happened.
    expect(after.startedAt).toEqual(started)
  })

  it('does not move the start time when a printing job is touched again', async () => {
    const id = await submit()
    await patchStatus(id, { status: 'PRINTING' })
    const first = (await prisma.printRequest.findUniqueOrThrow({ where: { id } }))
      .startedAt

    await patchStatus(id, { status: 'PRINTING', officerNote: 'Second sheet' })

    expect(
      (await prisma.printRequest.findUniqueOrThrow({ where: { id } })).startedAt,
    ).toEqual(first)
  })

  /** Officers print in whatever is on the shelf, so the row has to be able to
      say that the ask and the outcome differed. */
  it('records what was actually printed, leaving the ask alone', async () => {
    const id = await submit({ material: 'PLA' })

    await patchStatus(id, {
      status: 'DONE',
      gramsUsed: 30,
      printed: {
        process: 'FDM',
        material: 'PETG',
        infillPattern: 'GYROID',
        infillDensity: 25,
      },
    })

    expect(
      await prisma.printRequest.findUniqueOrThrow({ where: { id } }),
    ).toMatchObject({
      material: 'PLA',
      printedMaterial: 'PETG',
      printedInfillPattern: 'GYROID',
    })
  })

  it('refuses a correction the printers could not have done', async () => {
    const id = await submit()

    const response = await patchStatus(id, {
      status: 'DONE',
      gramsUsed: 30,
      printed: { process: 'SLA', material: 'PLA' },
    })

    expect(response.status).toBe(400)
  })

  /**
   * Found by id, never by "the first personal row".
   *
   * This queue is roster-wide by nature — it is the officers' whole to-do list
   * — so it answers with whatever real members have asked for as well as with
   * this suite's fixtures, and a real request sorts ahead of one made a moment
   * ago. Matching on a *shape* rather than on identity is how a test starts
   * asserting things about the club's actual data, and this one did.
   */
  it('puts the requester’s remaining grams beside a personal row, and not a project one', async () => {
    await alreadySpent(120)
    const personalId = await submit()
    const projectPrintId = await submit({ projectId: myProjectId })

    const response = await app.request('/api/officer/print-queue', {
      headers: { cookie: officerCookie },
    })
    const queue = (await response.json()) as {
      id: string
      project: { id: string } | null
      allowance: { usedGrams: number; remainingGrams: number } | null
    }[]

    expect(queue.find((row) => row.id === personalId)?.allowance).toMatchObject({
      usedGrams: 120,
      remainingGrams: env.PERSONAL_PRINT_GRAMS - 120,
    })

    // Uncapped, so there is no balance to weigh it against and none is shown.
    expect(queue.find((row) => row.id === projectPrintId)?.allowance).toBeNull()
  })

  it('REJECTED deletes the file too, and a settled request stays settled', async () => {
    const created = await upload(memberCookie, 'part.stl', asciiStl())
    const { id } = (await created.json()) as { id: string }

    await patchStatus(id, { status: 'REJECTED', officerNote: 'Too big for the bed.' })

    expect(
      await prisma.storedFile.count({
        where: { printRequest: { id } },
      }),
    ).toBe(0)

    const reopened = await patchStatus(id, { status: 'PENDING' })
    expect(reopened.status).toBe(409)
  })
})

describe('withdrawing', () => {
  it('a member withdraws their own pending request, bytes and all', async () => {
    const created = await upload(memberCookie, 'part.stl', asciiStl())
    const { id } = (await created.json()) as { id: string }
    const { fileId } = await prisma.printRequest.findUniqueOrThrow({
      where: { id },
      select: { fileId: true },
    })

    const response = await app.request(`/api/print/${id}`, {
      method: 'DELETE',
      headers: { cookie: memberCookie },
    })

    expect(response.status).toBe(200)
    expect(await prisma.printRequest.count({ where: { id } })).toBe(0)
    expect(await prisma.storedFile.count({ where: { id: fileId! } })).toBe(0)
  })

  it("cannot withdraw somebody else's, and cannot withdraw one being printed", async () => {
    const created = await upload(memberCookie, 'part.stl', asciiStl())
    const { id } = (await created.json()) as { id: string }

    const stranger = await app.request(`/api/print/${id}`, {
      method: 'DELETE',
      headers: { cookie: otherCookie },
    })
    expect(stranger.status).toBe(404)

    await patchStatus(id, { status: 'PRINTING' })
    const late = await app.request(`/api/print/${id}`, {
      method: 'DELETE',
      headers: { cookie: memberCookie },
    })
    expect(late.status).toBe(409)
  })
})

describe('my history', () => {
  it('keeps a settled request readable after its file is gone', async () => {
    const created = await upload(memberCookie, 'part.stl', asciiStl())
    const { id } = (await created.json()) as { id: string }
    await patchStatus(id, { status: 'DONE', gramsUsed: 18 })

    const response = await app.request('/api/me/print-requests', {
      headers: { cookie: memberCookie },
    })
    const mine = (await response.json()) as {
      id: string
      fileName: string
      fileId: string | null
    }[]

    expect(mine.find((r) => r.id === id)).toMatchObject({
      fileName: 'part.stl',
      fileId: null,
    })
  })
})
