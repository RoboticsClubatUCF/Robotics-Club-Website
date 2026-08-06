import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../app.js'
import { prisma } from '../db.js'
import { env } from '../env.js'

/**
 * The contact form, against the live database.
 *
 * Two things make this different from the read tests. It creates rows, so every
 * test cleans up after itself — a suite that leaves messages behind would fill
 * the officers' queue with test traffic. And it is rate limited by a counter
 * that lives in Postgres, which means the window survives the process: without
 * clearing it first, running these twice inside ten minutes would fail the
 * second time for reasons that have nothing to do with the code.
 *
 * The notification is stubbed for the same reason the rows are cleaned up. With
 * a real POSTMARK_TOKEN in `.env` an unstubbed run posts to Postmark for every
 * test here, and each one lands in the officers' actual inbox. The route fires
 * that call without awaiting it, so nothing would fail — the mail would just
 * arrive, several times, every time anybody ran the suite.
 */
vi.mock('../mail.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../mail.js')>()),
  sendContactNotification: vi.fn(async () => {}),
}))

const post = (body: unknown) =>
  app.request('/api/contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const valid = {
  name: 'Test Sender',
  email: 'test-sender@example.invalid',
  message: 'Automated test message.',
}

/** Every test starts with a fresh window, whatever the last one used up. */
const clearWindow = () =>
  prisma.rateLimit.deleteMany({ where: { key: { startsWith: 'forms:' } } })

const clearMessages = () =>
  prisma.contactMessage.deleteMany({ where: { email: valid.email } })

beforeEach(async () => {
  await clearWindow()
  await clearMessages()
})

afterAll(async () => {
  await clearWindow()
  await clearMessages()
  await prisma.$disconnect()
})

describe('POST /api/contact', () => {
  it('stores the message and hands back its id', async () => {
    const response = await post({ ...valid, subject: 'Test subject' })
    expect(response.status).toBe(201)

    const body = (await response.json()) as { id: string; status: string }
    expect(body.status).toBe('received')

    const stored = await prisma.contactMessage.findUnique({ where: { id: body.id } })
    expect(stored).toMatchObject({
      name: valid.name,
      email: valid.email,
      subject: 'Test subject',
      message: valid.message,
      status: 'NEW',
    })
  })

  /**
   * The row is the record, and email is a notification on top of it. With no
   * Postmark token configured the endpoint must still accept and store — a club
   * that hasn't set up mail yet can still be written to.
   */
  it('accepts a message whether or not mail is configured', async () => {
    const response = await post(valid)

    expect(response.status).toBe(201)
    expect(await prisma.contactMessage.count({ where: { email: valid.email } })).toBe(1)
  })

  it('keeps the subject optional', async () => {
    const response = await post(valid)
    const { id } = (await response.json()) as { id: string }

    const stored = await prisma.contactMessage.findUnique({ where: { id } })
    expect(stored?.subject).toBeNull()
  })

  it.each([
    ['a malformed address', { ...valid, email: 'not-an-email' }],
    ['an empty message', { ...valid, message: '   ' }],
    ['a missing name', { email: valid.email, message: valid.message }],
    ['an oversized message', { ...valid, message: 'x'.repeat(5001) }],
  ])('rejects %s without writing a row', async (_case, body) => {
    const response = await post(body)

    expect(response.status).toBe(400)
    expect(await prisma.contactMessage.count({ where: { email: valid.email } })).toBe(0)
  })

  /**
   * The limit is the only thing standing between this endpoint and a script, so
   * it is worth asserting it actually bites. Invalid bodies are used as the
   * filler: they are counted before they are validated, which is the point —
   * the limiter runs first — and they leave no rows to clean up.
   */
  it('stops accepting once the window is used up', async () => {
    for (let attempt = 0; attempt < env.RATE_LIMIT_MAX; attempt++) {
      const response = await post({ email: 'nope' })
      expect(response.status, `attempt ${attempt + 1}`).toBe(400)
    }

    const blocked = await post(valid)
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('Retry-After')).toBeTruthy()

    // And nothing was written by the request that was turned away.
    expect(await prisma.contactMessage.count({ where: { email: valid.email } })).toBe(0)
  })
})
