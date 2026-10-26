import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.js'
import { createSession } from '../../auth/session.js'
import { prisma } from '../../core/db.js'
import { env } from '../../core/env.js'
import { UserRole } from '../../generated/prisma/enums.js'

/**
 * Only paths that write nothing to real rows are exercised here: a successful add syncs against
 * today's window, which no fixture can keep to itself. The sync is covered in
 * `calendar/googleCalendar.test.ts`. `fetch` is stubbed wherever Google would be asked.
 */

const PREFIX = 'test-gcal-route-'
const address = (name: string) =>
  `https://calendar.google.com/calendar/ical/${PREFIX}${name}%40group.calendar.google.com/private-0000/basic.ics`

let cookies: Record<'officer' | 'member', string>

const clearRows = async () => {
  await prisma.googleCalendar.deleteMany({ where: { icsUrl: { contains: `/${PREFIX}` } } })
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
}
const clearWindows = () =>
  prisma.rateLimit.deleteMany({ where: { key: { startsWith: 'officer:' } } })

beforeEach(async () => {
  await clearWindows()
  await clearRows()
  const make = (name: string, role: UserRole) =>
    prisma.user.create({
      data: {
        fullName: `Calendar ${name}`,
        email: `${PREFIX}${name}@ucf.edu`,
        role,
        duesPaidThrough: new Date('2035-12-31T00:00:00'),
      },
    })
  const [officer, member] = await Promise.all([
    make('officer', UserRole.OFFICER),
    make('member', UserRole.MEMBER),
  ])
  const cookieFor = async (id: string) =>
    `${env.SESSION_COOKIE_NAME}=${(await createSession(id)).token}`
  cookies = { officer: await cookieFor(officer.id), member: await cookieFor(member.id) }
})

afterEach(() => {
  vi.unstubAllGlobals()
})

afterAll(async () => {
  await clearWindows()
  await clearRows()
  await prisma.$disconnect()
})

const request = (method: string, path: string, cookie: string, body?: unknown) =>
  app.request(`/api/officer/google-calendars${path}`, {
    method,
    headers: {
      cookie,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const ours = () =>
  prisma.googleCalendar.count({ where: { icsUrl: { contains: `/${PREFIX}` } } })

describe('the Google Calendar list', () => {
  it('is officers only', async () => {
    expect((await request('GET', '', cookies.member)).status).toBe(403)
    expect((await request('POST', '', cookies.member, { url: address('a') })).status).toBe(403)
    expect((await request('POST', '/sync', cookies.member)).status).toBe(403)
  })

  it('names each calendar and never sends its address back', async () => {
    await prisma.googleCalendar.create({ data: { icsUrl: address('listed'), name: 'Listed' } })

    const response = await request('GET', '', cookies.officer)
    expect(response.status).toBe(200)
    const list = (await response.json()) as Record<string, unknown>[]
    const mine = list.find((row) => row.name === 'Listed')
    expect(mine).toMatchObject({ calendar: `${PREFIX}listed@group.calendar.google.com` })
    expect(Object.keys(mine!).sort()).toEqual(['calendar', 'id', 'name', 'published', 'syncError', 'syncedAt'])
    expect(JSON.stringify(list)).not.toContain('private-')
  })

  it('refuses an address that is not a Google Calendar feed, without fetching it', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const response = await request('POST', '', cookies.officer, {
      url: 'https://localhost:5433/calendar/ical/a/private-b/basic.ics',
    })

    expect(response.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('saves nothing when the address does not load', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('nope', { status: 404 }))))

    const response = await request('POST', '', cookies.officer, { url: address('missing') })

    expect(response.status).toBe(400)
    expect(await ours()).toBe(0)
  })

  it('refuses the same calendar twice', async () => {
    await prisma.googleCalendar.create({ data: { icsUrl: address('twice') } })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const response = await request('POST', '', cookies.officer, { url: address('twice') })

    expect(response.status).toBe(409)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(await ours()).toBe(1)
  })

  it('keeps the old address when a new one does not load', async () => {
    const row = await prisma.googleCalendar.create({ data: { icsUrl: address('old') } })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('nope', { status: 404 }))))

    const response = await request('PUT', `/${row.id}`, cookies.officer, { url: address('new') })

    expect(response.status).toBe(400)
    expect(await prisma.googleCalendar.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      icsUrl: address('old'),
    })
  })

  it('answers 404 for a calendar that is not there', async () => {
    const response = await request('PUT', '/0198f0f0-0000-7000-8000-000000000000', cookies.officer, {
      url: address('nowhere'),
    })
    expect(response.status).toBe(404)
  })

  it('removes one calendar and leaves the rest', async () => {
    const [keep, drop] = await Promise.all([
      prisma.googleCalendar.create({ data: { icsUrl: address('keep') } }),
      prisma.googleCalendar.create({ data: { icsUrl: address('drop') } }),
    ])

    const response = await request('DELETE', `/${drop.id}`, cookies.officer)

    expect(response.status).toBe(200)
    expect(await prisma.googleCalendar.findUnique({ where: { id: drop.id } })).toBeNull()
    expect(await prisma.googleCalendar.findUnique({ where: { id: keep.id } })).not.toBeNull()
  })
})
