import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.js'
import { prisma } from '../../core/db.js'
import { env } from '../../core/env.js'
import { sendDirectMessage } from '../../discord/discord.js'
import { UserRole } from '../../generated/prisma/enums.js'

/**
 * The OpenProject routes. Discord is mocked: the dev `.env` holds the live bot token, and a
 * real DM here would reach a real member. Fixtures are prefixed and deleted by that prefix;
 * the snowflake is repeated digits so it can't belong to anybody.
 */

vi.mock('../../discord/discord.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../discord/discord.js')>()),
  sendDirectMessage: vi.fn(),
}))

const sent = vi.mocked(sendDirectMessage)

const PREFIX = 'test-openproject-'
const SECRET = 'x'.repeat(40)
const SNOWFLAKE = '888888888888888888'
const linked = `${PREFIX}linked@example.com`
const unlinked = `${PREFIX}unlinked@example.com`
const retired = `${PREFIX}retired@example.com`
const stranger = `${PREFIX}nobody@example.com`

const savedSecret = env.OPENPROJECT_SECRET

const post = (path: string, body: unknown, secret: string | null = SECRET) =>
  app.request(`/api/openproject/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret === null ? {} : { Authorization: `Bearer ${secret}` }),
    },
    body: JSON.stringify(body),
  })

const cleanUp = () => prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })

beforeAll(async () => {
  await cleanUp()
  await prisma.user.createMany({
    data: [
      { fullName: 'OP Linked', email: linked, discordId: SNOWFLAKE, role: UserRole.MEMBER },
      { fullName: 'OP Unlinked', email: unlinked, role: UserRole.GUEST },
      { fullName: 'OP Retired', email: retired, role: UserRole.MEMBER, active: false },
    ],
  })
})

afterAll(async () => {
  await cleanUp()
  env.OPENPROJECT_SECRET = savedSecret
})

beforeEach(() => {
  env.OPENPROJECT_SECRET = SECRET
  sent.mockReset()
  sent.mockResolvedValue({ status: 'sent' })
})

describe('the shared secret', () => {
  it('refuses everything when none is configured', async () => {
    env.OPENPROJECT_SECRET = undefined
    expect((await post('member', { email: linked })).status).toBe(503)
    expect((await post('notify', { email: linked, content: 'hello' })).status).toBe(503)
    expect(sent).not.toHaveBeenCalled()
  })

  it('refuses a missing or wrong secret before reading the body', async () => {
    expect((await post('member', { email: linked }, null)).status).toBe(401)
    expect((await post('member', { email: linked }, 'wrong')).status).toBe(401)
    expect((await post('notify', {}, 'wrong')).status).toBe(401)
    expect(sent).not.toHaveBeenCalled()
  })
})

describe('POST /api/openproject/member', () => {
  it('says yes to any active account, Discord or not, ignoring case', async () => {
    for (const email of [linked.toUpperCase(), unlinked]) {
      const res = await post('member', { email })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ member: true })
    }
  })

  it('says no to a retired account and an unknown address', async () => {
    for (const email of [retired, stranger]) {
      expect(await (await post('member', { email })).json()).toEqual({ member: false })
    }
  })
})

describe('POST /api/openproject/notify', () => {
  it('DMs the member whose email matches, ignoring case', async () => {
    const res = await post('notify', { email: linked.toUpperCase(), content: 'You were mentioned' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'sent' })
    expect(sent).toHaveBeenCalledWith(SNOWFLAKE, 'You were mentioned')
  })

  it('answers no_member without Discord, for a retired account, or an unknown email', async () => {
    for (const email of [unlinked, retired, stranger]) {
      const res = await post('notify', { email, content: 'hello' })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ status: 'no_member' })
    }
    expect(sent).not.toHaveBeenCalled()
  })

  it('passes on a refusal as final and an outage as retryable', async () => {
    sent.mockResolvedValueOnce({ status: 'refused', reason: 'open DM channel: 403 Forbidden' })
    const refused = await post('notify', { email: linked, content: 'hello' })
    expect(refused.status).toBe(200)
    expect(await refused.json()).toMatchObject({ status: 'refused' })

    sent.mockResolvedValueOnce({ status: 'unavailable', reason: 'network' })
    expect((await post('notify', { email: linked, content: 'hello' })).status).toBe(502)

    sent.mockResolvedValueOnce({ status: 'unchecked' })
    expect((await post('notify', { email: linked, content: 'hello' })).status).toBe(503)
  })

  it('refuses an empty or over-long message', async () => {
    expect((await post('notify', { email: linked, content: '' })).status).toBe(400)
    expect((await post('notify', { email: linked, content: 'x'.repeat(2001) })).status).toBe(400)
    expect(sent).not.toHaveBeenCalled()
  })
})
