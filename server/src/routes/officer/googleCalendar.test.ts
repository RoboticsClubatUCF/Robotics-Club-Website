import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.js'
import { createSession } from '../../auth/session.js'
import { prisma } from '../../core/db.js'
import { env } from '../../core/env.js'
import { UserRole } from '../../generated/prisma/enums.js'

/**
 * Only the paths that write nothing on success are exercised here. A successful save syncs against
 * today's window and a delete releases every import, and both would reach real rows. The sync
 * itself is covered in `calendar/googleCalendar.test.ts`.
 *
 * The settings row is borrowed: read before, restored after.
 */

const PREFIX = 'test-gcal-route-'
const GOOGLE_SHAPED =
  'https://calendar.google.com/calendar/ical/test%40group.calendar.google.com/private-0000/basic.ics'

let saved: Awaited<ReturnType<typeof prisma.googleCalendar.findUnique>>
let cookies: Record<'officer' | 'member', string>

const clearRows = () => prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
const clearWindows = () =>
  prisma.rateLimit.deleteMany({ where: { key: { startsWith: 'officer:' } } })

beforeAll(async () => {
  saved = await prisma.googleCalendar.findUnique({ where: { id: 'current' } })
})

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
  if (saved) {
    await prisma.googleCalendar.upsert({ where: { id: 'current' }, create: saved, update: saved })
  } else {
    await prisma.googleCalendar.deleteMany({ where: { id: 'current' } })
  }
  await clearWindows()
  await clearRows()
  await prisma.$disconnect()
})

const request = (method: string, cookie: string, body?: unknown) =>
  app.request('/api/officer/google-calendar', {
    method,
    headers: {
      cookie,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

describe('the Google Calendar setting', () => {
  it('is officers only', async () => {
    expect((await request('GET', cookies.member)).status).toBe(403)
    expect((await request('PUT', cookies.member, { url: GOOGLE_SHAPED })).status).toBe(403)
  })

  it('never sends the address back', async () => {
    const response = await request('GET', cookies.officer)
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['calendar', 'syncError', 'syncedAt'])
    expect(JSON.stringify(body)).not.toContain('private-')
  })

  it('refuses an address that is not a Google Calendar feed', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const response = await request('PUT', cookies.officer, {
      url: 'https://localhost:5433/calendar/ical/a/private-b/basic.ics',
    })

    expect(response.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('saves nothing when the address does not load', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('nope', { status: 404 }))))
    const before = await prisma.googleCalendar.findUnique({ where: { id: 'current' } })

    const response = await request('PUT', cookies.officer, { url: GOOGLE_SHAPED })

    expect(response.status).toBe(400)
    expect(await prisma.googleCalendar.findUnique({ where: { id: 'current' } })).toEqual(before)
  })
})
