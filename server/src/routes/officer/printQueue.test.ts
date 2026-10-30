import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.js'
import { prisma } from '../../core/db.js'
import { env } from '../../core/env.js'
import {
  PrintRequestStatus,
  ProjectMemberRank,
  Season,
  UserRole,
} from '../../generated/prisma/enums.js'
import { currentTerm } from '../../membership/semester.js'
import { createSession } from '../../auth/session.js'
import { pushRoles } from '../../discord/discordRoles.js'

/**
 * Who may work the print queue: officers, operators an officer let in, and project leads for
 * their own projects' waiting prints. Against the live database, with every row prefixed.
 *
 * Discord is stubbed at both doors: role writes (`pushRoles`) and print messages. A grant pushes
 * roles, and the dev `.env` has a real bot.
 */

vi.mock('../../discord/discord.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../discord/discord.js')>()),
  discordConfigured: true,
  sendDirectMessage: vi.fn(() =>
    Promise.resolve({ status: 'refused' as const, reason: 'privacy settings' }),
  ),
}))

vi.mock('../../discord/discordRoles.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../discord/discordRoles.js')>()),
  pushRoles: vi.fn(),
}))

vi.mock('../../discord/printNotify.js', () => ({
  notifyPrintChannel: vi.fn(() => Promise.resolve()),
  notifyPrintOwner: vi.fn(() => Promise.resolve()),
}))

const PREFIX = 'test-printq-'
const email = (name: string) => `${PREFIX}${name}@ucf.edu`

const PAID_UP = new Date('2035-12-31T23:59:59')
const LAPSED = new Date('2020-01-01T00:00:00')
const TRAINED = new Date('2035-09-01T00:00:00')

const clearWindows = () =>
  prisma.rateLimit.deleteMany({
    where: {
      OR: [{ key: { startsWith: 'print:' } }, { key: { startsWith: 'officer:' } }],
    },
  })

const clearRows = async () => {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: PREFIX } },
    select: { id: true },
  })
  await prisma.storedFile.deleteMany({
    where: { createdById: { in: users.map((u) => u.id) } },
  })
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
  await prisma.project.deleteMany({ where: { slug: { startsWith: PREFIX } } })
}

async function cookieFor(userId: string): Promise<string> {
  const { token } = await createSession(userId)
  return `${env.SESSION_COOKIE_NAME}=${token}`
}

const person = (
  name: string,
  extra: {
    role?: UserRole
    duesPaidThrough?: Date | null
    slicerTrainedAt?: Date | null
    printQueueGrantedAt?: Date | null
  } = {},
) =>
  prisma.user.create({
    data: {
      fullName: `Queue ${name}`,
      email: email(name),
      role: UserRole.MEMBER,
      duesPaidThrough: PAID_UP,
      ...extra,
    },
    select: { id: true },
  })

let ids: Record<'officer' | 'operator' | 'lead' | 'member' | 'plain', string>
let cookies: Record<keyof typeof ids, string>
/** The lead's project, and one they have nothing to do with. */
let ledProjectId: string
let otherProjectId: string
let term: { termYear: number; termSeason: Season }

beforeEach(async () => {
  vi.mocked(pushRoles).mockClear()
  await clearWindows()
  await clearRows()

  const [officer, operator, lead, member, plain] = await Promise.all([
    person('officer', { role: UserRole.OFFICER }),
    person('operator', { slicerTrainedAt: TRAINED, printQueueGrantedAt: TRAINED }),
    person('lead'),
    person('member'),
    person('plain'),
  ])
  ids = {
    officer: officer.id,
    operator: operator.id,
    lead: lead.id,
    member: member.id,
    plain: plain.id,
  }
  cookies = {
    officer: await cookieFor(officer.id),
    operator: await cookieFor(operator.id),
    lead: await cookieFor(lead.id),
    member: await cookieFor(member.id),
    plain: await cookieFor(plain.id),
  }

  const [led, other] = await Promise.all([
    prisma.project.create({
      data: {
        slug: `${PREFIX}led`,
        title: 'Queue Fixture Rover',
        termYear: 2035,
        termSeason: Season.FALL,
        members: {
          create: [
            { userId: lead.id, rank: ProjectMemberRank.PROJECT_LEAD },
            { userId: member.id },
          ],
        },
      },
    }),
    prisma.project.create({
      data: {
        slug: `${PREFIX}other`,
        title: 'Queue Fixture Blimp',
        termYear: 2035,
        termSeason: Season.FALL,
        members: { create: { userId: member.id } },
      },
    }),
  ])
  ledProjectId = led.id
  otherProjectId = other.id

  const now = await currentTerm()
  term = { termYear: now.year, termSeason: now.season }
})

afterAll(async () => {
  await clearWindows()
  await clearRows()
  await prisma.$disconnect()
})

/** A sent print, written straight in: the queue is what these tests are about. */
const print = async (
  owner: keyof typeof ids,
  extra: { projectId?: string; status?: PrintRequestStatus } = {},
) =>
  (
    await prisma.printRequest.create({
      data: {
        userId: ids[owner],
        fileName: `${PREFIX}part.stl`,
        fileSize: 10,
        status: extra.status ?? PrintRequestStatus.PENDING,
        projectId: extra.projectId ?? null,
        submittedAt: new Date(),
        ...term,
      },
      select: { id: true },
    })
  ).id

const move = (id: string, body: unknown, who: keyof typeof ids) =>
  app.request(`/api/officer/print/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', cookie: cookies[who] },
    body: JSON.stringify(body),
  })

type QueueRow = {
  id: string
  user: { email: string | null }
  can: { work: boolean; decline: boolean; override: boolean }
}

const queue = async (who: keyof typeof ids, query = '') => {
  const response = await app.request(`/api/officer/print-queue${query}`, {
    headers: { cookie: cookies[who] },
  })
  return {
    status: response.status,
    rows: response.ok ? ((await response.json()) as QueueRow[]) : [],
  }
}

const statusOf = async (id: string) =>
  (await prisma.printRequest.findUniqueOrThrow({ where: { id }, select: { status: true } }))
    .status

describe('who reaches the queue', () => {
  it('refuses a member with no grant and no project to lead', async () => {
    expect((await queue('plain')).status).toBe(403)
  })

  it('refuses an operator whose dues have lapsed, and lets them back once paid', async () => {
    await prisma.user.update({ where: { id: ids.operator }, data: { duesPaidThrough: LAPSED } })
    expect((await queue('operator')).status).toBe(403)

    await prisma.user.update({ where: { id: ids.operator }, data: { duesPaidThrough: PAID_UP } })
    expect((await queue('operator')).status).toBe(200)
  })

  it('keeps members’ addresses for officers', async () => {
    const id = await print('member')

    const asOfficer = (await queue('officer')).rows.find((row) => row.id === id)
    const asOperator = (await queue('operator')).rows.find((row) => row.id === id)

    expect(asOfficer?.user.email).toBe(email('member'))
    expect(asOperator?.user.email).toBeNull()
  })
})

describe('an operator', () => {
  it('puts somebody else’s print on the printer and finishes it', async () => {
    const id = await print('member')

    expect((await move(id, { status: 'PRINTING' }, 'operator')).status).toBe(200)
    expect((await move(id, { status: 'DONE', gramsUsed: 12 }, 'operator')).status).toBe(200)

    expect(
      await prisma.printRequest.findUniqueOrThrow({
        where: { id },
        select: { status: true, decidedById: true },
      }),
    ).toEqual({ status: PrintRequestStatus.DONE, decidedById: ids.operator })
  })

  it('cannot touch their own print, and the queue says so per row', async () => {
    const own = await print('operator')
    const theirs = await print('member')

    const response = await move(own, { status: 'PRINTING' }, 'operator')
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('your own') })

    const { rows } = await queue('operator')
    expect(rows.find((row) => row.id === own)?.can.work).toBe(false)
    expect(rows.find((row) => row.id === theirs)?.can).toEqual({
      work: true,
      decline: false,
      override: false,
    })
  })

  it('cannot decline a waiting print', async () => {
    const waiting = await print('member')

    expect((await move(waiting, { status: 'REJECTED' }, 'operator')).status).toBe(403)
    expect(await statusOf(waiting)).toBe(PrintRequestStatus.PENDING)
  })

  it('stops somebody else’s running print, but not their own', async () => {
    const running = await print('member', { status: PrintRequestStatus.PRINTING })
    const own = await print('operator', { status: PrintRequestStatus.PRINTING })

    expect((await move(running, { status: 'REJECTED' }, 'operator')).status).toBe(200)
    expect(await statusOf(running)).toBe(PrintRequestStatus.REJECTED)
    expect((await move(own, { status: 'REJECTED' }, 'operator')).status).toBe(403)

    const { rows } = await queue('operator', '?all=1')
    expect(rows.find((row) => row.id === own)?.can.decline).toBe(false)
  })

  it('cannot print past somebody’s allowance, and is told to ask an officer', async () => {
    await prisma.printRequest.create({
      data: {
        userId: ids.member,
        fileName: `${PREFIX}history.stl`,
        fileSize: 10,
        status: PrintRequestStatus.DONE,
        gramsUsed: env.PERSONAL_PRINT_GRAMS - 5,
        ...term,
      },
    })
    const id = await print('member')

    const over = await move(id, { status: 'DONE', gramsUsed: 20 }, 'operator')
    expect(over.status).toBe(409)
    expect(await over.json()).toMatchObject({ error: expect.stringContaining('Ask an officer') })

    const forced = await move(id, { status: 'DONE', gramsUsed: 20, overAllowance: true }, 'operator')
    expect(forced.status).toBe(403)

    const officer = await move(id, { status: 'DONE', gramsUsed: 20, overAllowance: true }, 'officer')
    expect(officer.status).toBe(200)
  })

  it('cannot start a print for somebody with nothing left; an officer can', async () => {
    await prisma.printRequest.create({
      data: {
        userId: ids.member,
        fileName: `${PREFIX}history.stl`,
        fileSize: 10,
        status: PrintRequestStatus.DONE,
        gramsUsed: env.PERSONAL_PRINT_GRAMS,
        ...term,
      },
    })
    const id = await print('member')

    const response = await move(id, { status: 'PRINTING' }, 'operator')
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('Ask an officer') })

    expect((await move(id, { status: 'PRINTING' }, 'officer')).status).toBe(200)
  })

  it('downloads a member’s uploaded model, which a plain member cannot', async () => {
    const form = new FormData()
    form.append('file', new File([new TextEncoder().encode('solid p\nendsolid p\n')], 'p.stl'))
    form.append('process', 'SLA')
    form.append('material', 'ABS_LIKE_RESIN')
    const created = await app.request('/api/print', {
      method: 'POST',
      body: form,
      headers: { cookie: cookies.member },
    })
    const { id } = (await created.json()) as { id: string }
    const { fileId } = await prisma.printRequest.findUniqueOrThrow({
      where: { id },
      select: { fileId: true },
    })

    const operator = await app.request(`/api/files/${fileId}`, {
      headers: { cookie: cookies.operator },
    })
    expect(operator.status).toBe(200)

    const plain = await app.request(`/api/files/${fileId}`, {
      headers: { cookie: cookies.plain },
    })
    expect(plain.status).toBe(403)
  })
})

describe('a project lead', () => {
  it('sees their project’s prints and nobody else’s', async () => {
    const forLed = await print('member', { projectId: ledProjectId })
    const forOther = await print('member', { projectId: otherProjectId })
    const personal = await print('member')

    const { status, rows } = await queue('lead')
    expect(status).toBe(200)
    const seen = rows.map((row) => row.id)
    expect(seen).toContain(forLed)
    expect(seen).not.toContain(forOther)
    expect(seen).not.toContain(personal)
    expect(rows.find((row) => row.id === forLed)?.can).toEqual({
      work: false,
      decline: true,
      override: false,
    })
  })

  it('declines a waiting print for their project', async () => {
    const id = await print('member', { projectId: ledProjectId })

    const response = await move(id, { status: 'REJECTED', officerNote: 'We have spares' }, 'lead')

    expect(response.status).toBe(200)
    expect(await statusOf(id)).toBe(PrintRequestStatus.REJECTED)
  })

  it('cannot start a print, decline another project’s, or stop one on the printer', async () => {
    const waiting = await print('member', { projectId: ledProjectId })
    const elsewhere = await print('member', { projectId: otherProjectId })
    const running = await print('member', {
      projectId: ledProjectId,
      status: PrintRequestStatus.PRINTING,
    })

    expect((await move(waiting, { status: 'PRINTING' }, 'lead')).status).toBe(403)
    expect((await move(elsewhere, { status: 'REJECTED' }, 'lead')).status).toBe(403)
    expect((await move(running, { status: 'REJECTED' }, 'lead')).status).toBe(403)
  })

  it('loses it with their dues', async () => {
    await prisma.user.update({ where: { id: ids.lead }, data: { duesPaidThrough: LAPSED } })
    const id = await print('member', { projectId: ledProjectId })

    expect((await queue('lead')).status).toBe(403)
    expect((await move(id, { status: 'REJECTED' }, 'lead')).status).toBe(403)
  })
})

describe('granting the queue', () => {
  const grant = (userId: string, who: keyof typeof ids = 'officer') =>
    app.request(`/api/officer/print-operators/${userId}`, {
      method: 'PUT',
      headers: { cookie: cookies[who] },
    })

  const revoke = (userId: string) =>
    app.request(`/api/officer/print-operators/${userId}`, {
      method: 'DELETE',
      headers: { cookie: cookies.officer },
    })

  it('is officers only', async () => {
    await prisma.user.update({ where: { id: ids.plain }, data: { slicerTrainedAt: TRAINED } })

    expect((await grant(ids.plain, 'operator')).status).toBe(403)
    const list = await app.request('/api/officer/print-operators', {
      headers: { cookie: cookies.operator },
    })
    expect(list.status).toBe(403)
  })

  it('lets in a trained, paid-up member and pushes their roles', async () => {
    await prisma.user.update({ where: { id: ids.plain }, data: { slicerTrainedAt: TRAINED } })

    const response = await grant(ids.plain)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      id: ids.plain,
      active: true,
      grantedBy: { fullName: 'Queue officer' },
    })
    expect(pushRoles).toHaveBeenCalledWith(ids.plain, 'given the print queue')
    expect((await queue('plain')).status).toBe(200)
  })

  it('refuses a member who hasn’t finished the slicer training', async () => {
    const response = await grant(ids.plain)

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('training') })
  })

  it('refuses a member whose dues aren’t current', async () => {
    await prisma.user.update({
      where: { id: ids.plain },
      data: { slicerTrainedAt: TRAINED, duesPaidThrough: LAPSED },
    })

    expect((await grant(ids.plain)).status).toBe(409)
  })

  it('keeps the first grant when pressed twice', async () => {
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: ids.operator },
      select: { printQueueGrantedAt: true },
    })

    expect((await grant(ids.operator)).status).toBe(200)

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: ids.operator },
      select: { printQueueGrantedAt: true },
    })
    expect(after.printQueueGrantedAt).toEqual(before.printQueueGrantedAt)
    expect(pushRoles).not.toHaveBeenCalled()
  })

  it('lists operators, and flags one whose dues lapsed', async () => {
    await prisma.user.update({ where: { id: ids.operator }, data: { duesPaidThrough: LAPSED } })

    const response = await app.request('/api/officer/print-operators', {
      headers: { cookie: cookies.officer },
    })
    const rows = (await response.json()) as { id: string; active: boolean }[]

    expect(rows.find((row) => row.id === ids.operator)).toMatchObject({ active: false })
    expect(rows.find((row) => row.id === ids.plain)).toBeUndefined()
  })

  it('takes it back, and the queue closes to them', async () => {
    const response = await revoke(ids.operator)

    expect(await response.json()).toEqual({ removed: true })
    expect(pushRoles).toHaveBeenCalledWith(ids.operator, 'print queue taken away')
    expect((await queue('operator')).status).toBe(403)
  })
})
