import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.js'
import { prisma } from '../../core/db.js'
import { env } from '../../core/env.js'
import { UserRole } from '../../generated/prisma/enums.js'
import { createSession } from '../../auth/session.js'

/**
 * The roles desk's title panel: an officer overwriting or clearing the line a member wrote
 * under their own name.
 */

// This route pushes no roles, but it shares a router with ones that do, and the dev `.env`
// carries a live bot token against the club's real server.
vi.mock('../../discord/discord.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../discord/discord.js')>()),
  officerSyncConfigured: false,
  officerRoleId: null,
  memberRoleId: null,
  projectLeadRoleId: null,
  teamLeadRoleId: null,
  addGuildRole: vi.fn(() => Promise.resolve({ status: 'done' as const })),
  removeGuildRole: vi.fn(() => Promise.resolve({ status: 'done' as const })),
  guildRoster: vi.fn(() => Promise.resolve({ status: 'unchecked' as const })),
  guildRoles: vi.fn(() => Promise.resolve({ status: 'unchecked' as const })),
}))

const PREFIX = 'test-title-'
const email = (name: string) => `${PREFIX}${name}@ucf.edu`

/** Far future, so `requireCurrentDues` passes without reading UCF's calendar. */
const PAID_THROUGH = new Date(2099, 11, 31)

const clearWindows = () =>
  prisma.rateLimit.deleteMany({ where: { key: { startsWith: 'officer:' } } })

const clearRows = () =>
  prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })

async function cookieFor(userId: string): Promise<string> {
  const { token } = await createSession(userId)
  return `${env.SESSION_COOKIE_NAME}=${token}`
}

const setTitle = (cookie: string, userId: string, title: unknown) =>
  app.request(`/api/officer/members/${userId}/title`, {
    method: 'PATCH',
    headers: {
      cookie,
      origin: env.SITE_URL,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title }),
  })

const titleOf = async (userId: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).title

let officerCookie = ''
let memberCookie = ''
let memberId = ''

beforeEach(async () => {
  await clearWindows()
  await clearRows()

  const [officer, member] = await Promise.all([
    prisma.user.create({
      data: {
        fullName: 'Title Officer',
        email: email('officer'),
        role: UserRole.OFFICER,
        duesPaidThrough: PAID_THROUGH,
      },
    }),
    prisma.user.create({
      data: {
        fullName: 'Title Member',
        email: email('member'),
        role: UserRole.MEMBER,
        duesPaidThrough: PAID_THROUGH,
        title: 'Self-Appointed Overlord',
      },
    }),
  ])

  memberId = member.id
  officerCookie = await cookieFor(officer.id)
  memberCookie = await cookieFor(member.id)
})

afterAll(async () => {
  await clearWindows()
  await clearRows()
  await prisma.$disconnect()
})

describe('PATCH /api/officer/members/:id/title', () => {
  it('overwrites the title a member set', async () => {
    const response = await setTitle(officerCookie, memberId, ' Rover Lead ')

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: memberId, title: 'Rover Lead' })
    expect(await titleOf(memberId)).toBe('Rover Lead')
  })

  it('clears it on null or blank', async () => {
    expect((await setTitle(officerCookie, memberId, null)).status).toBe(200)
    expect(await titleOf(memberId)).toBeNull()

    await prisma.user.update({ where: { id: memberId }, data: { title: 'Back' } })

    expect((await setTitle(officerCookie, memberId, '   ')).status).toBe(200)
    expect(await titleOf(memberId)).toBeNull()
  })

  it('refuses a title over 80 characters', async () => {
    expect((await setTitle(officerCookie, memberId, 'x'.repeat(81))).status).toBe(400)
    expect(await titleOf(memberId)).toBe('Self-Appointed Overlord')
  })

  it('answers 404 for somebody who does not exist', async () => {
    const response = await setTitle(
      officerCookie,
      '00000000-0000-7000-8000-000000000000',
      'Nobody',
    )

    expect(response.status).toBe(404)
  })

  it('refuses a member, even on their own row', async () => {
    expect((await setTitle(memberCookie, memberId, 'Club President')).status).toBe(403)
    expect(await titleOf(memberId)).toBe('Self-Appointed Overlord')
  })
})

describe('GET /api/officer/members', () => {
  it('carries the title, so the desk starts from what is there', async () => {
    const response = await app.request(
      `/api/officer/members?query=${encodeURIComponent(PREFIX)}`,
      { headers: { cookie: officerCookie } },
    )
    const members = (await response.json()) as { id: string; title: string | null }[]

    expect(response.status).toBe(200)
    expect(members.find((row) => row.id === memberId)?.title).toBe(
      'Self-Appointed Overlord',
    )
  })
})
