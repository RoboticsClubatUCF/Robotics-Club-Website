import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.js'
import { prisma } from '../../core/db.js'
import { env } from '../../core/env.js'

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
vi.mock('../../email/mail.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../email/mail.js')>()),
  sendContactNotification: vi.fn(async () => {}),
}))

const post = (body: unknown) =>
  app.request('/api/contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

/** The read the form makes before it draws itself. */
const available = () => app.request('/api/contact')

type Availability = {
  allowed: boolean
  remaining: number
  retryAfter: number
  message: string | null
}

const valid = {
  name: 'Test Sender',
  email: 'test-sender@example.invalid',
  message: 'Automated test message.',
}

/**
 * Every test starts with a fresh window, whatever the last one used up.
 *
 * **Both** windows. The ten-minute burst budget and the two-a-day ceiling are
 * separate rows under separate scopes, and the daily one is the reason this
 * cannot be left to expire on its own: three of the cases below send a valid
 * message, so without clearing it the third test in the file would be refused
 * by the second one's spending.
 */
const clearWindow = () =>
  prisma.rateLimit.deleteMany({
    where: {
      OR: [
        { key: { startsWith: 'forms:' } },
        { key: { startsWith: 'contact-day:' } },
      ],
    },
  })

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

/**
 * The daily ceiling, which is a different shape of limit from the one above.
 *
 * `forms:` is a rate — it stops a script and resets in ten minutes. This is a
 * count, and it is what a bot pacing itself to one message every eleven minutes
 * runs into: the rate never notices that, and the officers find a hundred rows
 * in the morning.
 */
describe('the two-a-day ceiling on /api/contact', () => {
  it('takes two and refuses the third', async () => {
    expect((await post(valid)).status).toBe(201)
    expect((await post(valid)).status).toBe(201)

    const third = await post(valid)
    expect(third.status).toBe(429)
    expect(third.headers.get('Retry-After')).toBeTruthy()
    // A day, not the ten-minute default — the two limits are separate windows
    // and a shared scope would have silently given this one the shorter expiry.
    expect(Number(third.headers.get('Retry-After'))).toBeGreaterThan(
      env.RATE_LIMIT_WINDOW_SECONDS,
    )

    // Two rows, not three: the refusal happens before the write.
    expect(await prisma.contactMessage.count({ where: { email: valid.email } })).toBe(2)
  })

  /**
   * The budget is two *messages*, not two attempts, and the position of the
   * `consume` in the route is the whole of that. A mistyped address is turned
   * down by the validator and must cost nothing — otherwise the sender is told
   * to check the fields, does, and is then refused for the day.
   */
  it('does not spend a day on a body it rejected', async () => {
    expect((await post({ ...valid, email: 'not-an-email' })).status).toBe(400)

    expect((await post(valid)).status).toBe(201)
    expect((await post(valid)).status).toBe(201)
    expect(await prisma.contactMessage.count({ where: { email: valid.email } })).toBe(2)
  })

  it('reports what is left, and counts down as they are sent', async () => {
    expect(await (await available()).json()).toMatchObject({
      allowed: true,
      remaining: 2,
      message: null,
    })

    const first = (await (await post(valid)).json()) as { remaining: number }
    expect(first.remaining).toBe(1)
    expect(await (await available()).json()).toMatchObject({
      allowed: true,
      remaining: 1,
    })

    const second = (await (await post(valid)).json()) as { remaining: number }
    expect(second.remaining).toBe(0)

    const spent = (await (await available()).json()) as Availability
    expect(spent.allowed).toBe(false)
    expect(spent.remaining).toBe(0)
    expect(spent.retryAfter).toBeGreaterThan(env.RATE_LIMIT_WINDOW_SECONDS)
    // A sentence to put on the page, rather than the browser inventing one.
    expect(spent.message).toBeTruthy()
  })

  /**
   * The property that makes the check safe to put in front of the form: asking
   * whether you may write must not itself be writing. A `consume` here would
   * mean a page that used up its own visitor's allowance by rendering.
   */
  it('costs nothing to ask', async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await available()).status).toBe(200)
    }

    expect(await (await available()).json()).toMatchObject({ remaining: 2 })
    expect((await post(valid)).status).toBe(201)
    expect((await post(valid)).status).toBe(201)
  })

  /** Per-caller and never shared, so it must not be cached anywhere. */
  it('never lets the answer be cached', async () => {
    const response = await available()

    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})
