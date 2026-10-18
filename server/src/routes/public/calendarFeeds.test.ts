import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.js'
import { prisma } from '../../core/db.js'
import { env } from '../../core/env.js'
import { createSession } from '../../auth/session.js'
import { MeetingRepeat, UserRole } from '../../generated/prisma/enums.js'
import { clearCalendarCache, currentTerm } from '../../membership/semester.js'

/**
 * The subscription feeds, and the rule they share with the site's own calendars: nobody's
 * feed shows something the site wouldn't show them.
 *
 * The feeds read real rows too, so every assertion is about a fixture's own UID.
 */

const PREFIX = 'test-calfeed-'
const email = (name: string) => `${PREFIX}${name}@ucf.edu`
const DAY_MS = 24 * 60 * 60 * 1000

const clearRows = async () => {
  await prisma.project.deleteMany({ where: { slug: { startsWith: PREFIX } } })
  // Club events have no project to cascade from.
  await prisma.event.deleteMany({ where: { slug: { startsWith: PREFIX } } })
  // Takes `calendar_feeds` with it.
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
}

let cookies: Record<'member' | 'officer' | 'outsider', string>
let tokens: Record<'member' | 'officer' | 'outsider', string>
let ids: Record<'privateProject' | 'publicProject' | 'published' | 'tentative' | 'review', string>

const get = (path: string, cookie?: string) =>
  app.request(path, { headers: cookie ? { cookie } : {} })

const tokenFor = async (cookie: string) =>
  ((await (await get('/api/me/calendar', cookie)).json()) as { token: string }).token

beforeAll(() => {
  // Term dates come from the fallback rather than calendar.ucf.edu.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('no network in tests')))
  clearCalendarCache()
})

beforeEach(async () => {
  await clearRows()

  const [member, officer, outsider] = await Promise.all(
    (
      [
        ['member', UserRole.MEMBER],
        ['officer', UserRole.OFFICER],
        ['outsider', UserRole.MEMBER],
      ] as const
    ).map(([name, role]) =>
      prisma.user.create({
        data: {
          fullName: `Feeds ${name}`,
          email: email(name),
          role,
          duesPaidThrough: new Date('2035-12-31T00:00:00'),
        },
      }),
    ),
  )

  const term = await currentTerm()
  const schedule = {
    termYear: term.year,
    termSeason: term.season,
    // Every day, so the window always holds some.
    meetingRepeat: MeetingRepeat.WEEKLY,
    meetingWeekdays: [0, 1, 2, 3, 4, 5, 6],
    meetingStartTime: '18:00',
    meetingEndTime: '20:00',
  }

  const privateProject = await prisma.project.create({
    data: {
      slug: `${PREFIX}rover`,
      title: 'Feeds Rover',
      meetingsPublic: false,
      ...schedule,
      members: { create: [{ userId: member.id }] },
    },
  })
  const publicProject = await prisma.project.create({
    data: { slug: `${PREFIX}arm`, title: 'Feeds Arm', meetingsPublic: true, ...schedule },
  })

  const soon = (days: number) => new Date(Date.now() + days * DAY_MS)
  const event = (slug: string, data: Record<string, unknown>) =>
    prisma.event.create({
      data: { slug: `${PREFIX}${slug}`, title: `Feeds ${slug}`, startsAt: soon(7), ...data },
    })

  const [published, tentative, review] = await Promise.all([
    event('open-house', { published: true }),
    event('tentative', { published: false, startsAt: soon(14) }),
    event('review', { published: false, projectId: privateProject.id, startsAt: soon(3) }),
  ])

  ids = {
    privateProject: privateProject.id,
    publicProject: publicProject.id,
    published: published.id,
    tentative: tentative.id,
    review: review.id,
  }

  cookies = {
    member: `${env.SESSION_COOKIE_NAME}=${(await createSession(member.id)).token}`,
    officer: `${env.SESSION_COOKIE_NAME}=${(await createSession(officer.id)).token}`,
    outsider: `${env.SESSION_COOKIE_NAME}=${(await createSession(outsider.id)).token}`,
  }
  tokens = {
    member: await tokenFor(cookies.member),
    officer: await tokenFor(cookies.officer),
    outsider: await tokenFor(cookies.outsider),
  }
})

afterAll(async () => {
  vi.unstubAllGlobals()
  await clearRows()
  await prisma.$disconnect()
})

const meetingUid = (projectId: string) => `UID:meeting-${projectId}-`

describe('GET /api/calendar/club.ics', () => {
  it('is a public, cacheable calendar of what the public calendar shows', async () => {
    const response = await get('/api/calendar/club.ics')
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/calendar')
    expect(response.headers.get('cache-control')).toContain('public')

    expect(body).toContain(`UID:${ids.published}@rccf`)
    expect(body).toContain(meetingUid(ids.publicProject))

    expect(body).not.toContain(`UID:${ids.tentative}@rccf`)
    expect(body).not.toContain(`UID:${ids.review}@rccf`)
    expect(body).not.toContain(meetingUid(ids.privateProject))
  })

  it('keeps a cancelled meeting, marked', async () => {
    // The first meeting from tomorrow on, whatever the term's dates turn out to be.
    const tomorrow = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
    }).format(new Date(Date.now() + DAY_MS))
    const before = await (await get('/api/calendar/club.ics')).text()
    const campus = [
      ...before.matchAll(new RegExp(`meeting-${ids.publicProject}-([0-9-]{10})@rccf`, 'g')),
    ]
      .map((match) => match[1] ?? '')
      .find((date) => date >= tomorrow)
    expect(campus).toBeDefined()

    await prisma.projectMeetingCancellation.create({
      data: { projectId: ids.publicProject, date: campus!, reason: 'Lab closed' },
    })

    const body = (await (await get('/api/calendar/club.ics')).text()).replace(
      /\r\n /g,
      '',
    )
    const block = body
      .split('BEGIN:VEVENT')
      .find((part) => part.includes(`meeting-${ids.publicProject}-${campus}@rccf`))

    expect(block).toContain('SUMMARY:Cancelled: Feeds Arm meeting')
    expect(block).toContain('STATUS:CANCELLED')
    expect(block).toContain('DESCRIPTION:Lab closed')
  })
})

describe('GET /api/calendar/:token/projects/:slug.ics', () => {
  it('gives a member every event and meeting of their project, privately', async () => {
    const response = await get(`/api/calendar/${tokens.member}/projects/${PREFIX}rover.ics`)
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('private')
    expect(body).toContain(`UID:${ids.review}@rccf`)
    expect(body).toContain(meetingUid(ids.privateProject))
    expect(body).toContain('X-WR-CALNAME:RCCF · Feeds Rover')

    expect(body).not.toContain(`UID:${ids.published}@rccf`)
    expect(body).not.toContain(meetingUid(ids.publicProject))
  })

  it('refuses somebody who is not on the project', async () => {
    const response = await get(`/api/calendar/${tokens.outsider}/projects/${PREFIX}rover.ics`)
    expect(response.status).toBe(404)
  })

  it('lets an officer subscribe to any project', async () => {
    const response = await get(`/api/calendar/${tokens.officer}/projects/${PREFIX}rover.ics`)
    expect(response.status).toBe(200)
  })

  it('stops working the moment somebody leaves', async () => {
    await prisma.projectMember.deleteMany({ where: { projectId: ids.privateProject } })

    const response = await get(`/api/calendar/${tokens.member}/projects/${PREFIX}rover.ics`)
    expect(response.status).toBe(404)
  })

  it('answers 404 for a token that matches nobody, or a path without .ics', async () => {
    const stranger = 'A'.repeat(43)
    expect((await get(`/api/calendar/${stranger}/projects/${PREFIX}rover.ics`)).status).toBe(404)
    expect((await get(`/api/calendar/not-a-token/projects/${PREFIX}rover.ics`)).status).toBe(404)
    expect((await get(`/api/calendar/${tokens.member}/projects/${PREFIX}rover`)).status).toBe(404)
  })
})

describe('GET /api/calendar/:token/officers.ics', () => {
  it('gives officers the club-wide events that are not public yet', async () => {
    const response = await get(`/api/calendar/${tokens.officer}/officers.ics`)
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(body).toContain(`UID:${ids.tentative}@rccf`)
    expect(body).not.toContain(`UID:${ids.published}@rccf`)
    expect(body).not.toContain(`UID:${ids.review}@rccf`)
  })

  it('moves an event to the club feed once it is published', async () => {
    await prisma.event.update({ where: { id: ids.tentative }, data: { published: true } })

    const officers = await (await get(`/api/calendar/${tokens.officer}/officers.ics`)).text()
    const club = await (await get('/api/calendar/club.ics')).text()

    expect(officers).not.toContain(`UID:${ids.tentative}@rccf`)
    expect(club).toContain(`UID:${ids.tentative}@rccf`)
  })

  it('refuses members', async () => {
    const response = await get(`/api/calendar/${tokens.member}/officers.ics`)
    expect(response.status).toBe(404)
  })
})

describe('the token', () => {
  it('is made once and kept', async () => {
    expect(await tokenFor(cookies.member)).toBe(tokens.member)
    expect(tokens.member).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('needs a session', async () => {
    expect((await get('/api/me/calendar')).status).toBe(401)
  })

  it('kills the old links when reset', async () => {
    const response = await app.request('/api/me/calendar/reset', {
      method: 'POST',
      headers: { cookie: cookies.member },
    })
    const { token } = (await response.json()) as { token: string }

    expect(response.status).toBe(200)
    expect(token).not.toBe(tokens.member)
    expect(
      (await get(`/api/calendar/${tokens.member}/projects/${PREFIX}rover.ics`)).status,
    ).toBe(404)
    expect(
      (await get(`/api/calendar/${token}/projects/${PREFIX}rover.ics`)).status,
    ).toBe(200)
  })
})
