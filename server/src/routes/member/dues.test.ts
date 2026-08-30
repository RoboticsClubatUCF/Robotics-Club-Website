import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.js'
import { prisma } from '../../core/db.js'
import { env } from '../../core/env.js'
import { Season, UserRole } from '../../generated/prisma/enums.js'
import { hashPassword } from '../../auth/password.js'
import { clearCalendarCache, getTerm, trialEndsAt } from '../../membership/semester.js'
import { stripe, stripeConfigured, webhooksConfigured } from '../../payments/stripe.js'
import { applyPayment, membershipUpdateFor } from './dues.js'

/**
 * Dues, against the live database.
 *
 * The half that matters most is `applyPayment`, and it is tested directly
 * rather than through Stripe. Crediting a payment exactly once is the only
 * thing on this path that costs the club money when it goes wrong: Stripe
 * retries a webhook until something answers 2xx, may deliver the same event
 * twice regardless, and the member's own browser calls `/dues/sync` at roughly
 * the same moment — so the same successful payment routinely arrives two or
 * three times, and every one of those must add one semester, not three.
 *
 * `fetch` is stubbed to fail so the suite never calls calendar.ucf.edu. The
 * fallback dates are then in play, which is fine here: nothing below asserts a
 * specific date, only which side of one things land. `semester.test.ts` is
 * where the calendar itself is checked.
 */

/**
 * Outright, never optionally — and here the reason is stronger than the one on
 * `print.test.ts`. All three writers of `duesPaidThrough` now push Discord
 * roles, and a role write is not a message somebody can ignore: it changes
 * what a real person can see in the club's actual server. The dev `.env` has a
 * live bot token, and the moment anybody sets `DISCORD_MEMBER_ROLE_ID` there,
 * an unmocked run of this suite hands out and takes away real roles.
 */
vi.mock('../../discord/discord.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../discord/discord.js')>()),
  // Signing in follows the club's officer role now — see
  // `refreshOfficerStanding` — so an unmocked `signIn()` here would reach
  // Discord on the dev token. Switched off rather than stubbed: this suite is
  // about dues, and the refresh returns before any call at all when the sync
  // is not configured.
  officerSyncConfigured: false,
  officerRoleId: null,
  memberRoleId: null,
  projectLeadRoleId: null,
  teamLeadRoleId: null,
  addGuildRole: vi.fn(() => Promise.resolve({ status: 'done' as const })),
  removeGuildRole: vi.fn(() => Promise.resolve({ status: 'done' as const })),
  guildRoster: vi.fn(() =>
    Promise.resolve({ status: 'unchecked' as const }),
  ),
  guildRoles: vi.fn(() => Promise.resolve({ status: 'unchecked' as const })),
}))

const EMAIL = 'test-dues@ucf.edu'
const PASSWORD = 'a-long-enough-password'
const INTENT = 'pi_test_dues_fixture'

let userId = ''

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

async function signIn(): Promise<string> {
  const response = await post('/api/auth/login', {
    email: EMAIL,
    password: PASSWORD,
  })

  return (response.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
}

const clearWindows = () =>
  prisma.rateLimit.deleteMany({
    where: {
      OR: [
        { key: { startsWith: 'login:' } },
        { key: { startsWith: 'login-account:' } },
        { key: { startsWith: 'dues:' } },
        { key: { startsWith: 'dues-sync:' } },
      ],
    },
  })

const clearRows = () => prisma.user.deleteMany({ where: { email: EMAIL } })

beforeEach(async () => {
  clearCalendarCache()
  // Offline, deterministically. Every term falls back to its fixed dates.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('nope', { status: 503 }))),
  )

  await clearWindows()
  await clearRows()

  const user = await prisma.user.create({
    data: {
      fullName: 'Test Dues',
      email: EMAIL,
      passwordHash: await hashPassword(PASSWORD),
      // No dues date — that is what this suite is about — but the survey is
      // answered, because it is the gate *in front of* dues. Without it every
      // checkout here would 403 on the survey and never reach the code under
      // test. The gate itself is exercised in its own describe below.
      surveyCompletedAt: new Date('2035-09-01T00:00:00'),
    },
    select: { id: true },
  })

  userId = user.id
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearCalendarCache()
})

afterAll(async () => {
  await clearWindows()
  await clearRows()
  await prisma.$disconnect()
})

/** A payment intent this server created, in the state checkout leaves it. */
async function pendingPayment(
  coversThrough: Date,
  amountCents = env.DUES_SEMESTER_CENTS,
) {
  await prisma.duesPayment.create({
    data: {
      userId,
      plan: 'SEMESTER',
      amountCents,
      status: 'PENDING',
      stripePaymentIntentId: INTENT,
      termYear: coversThrough.getFullYear(),
      termSeason: 'FALL',
      coversThrough,
    },
  })
}

const paidThroughOf = async () =>
  (
    await prisma.user.findUnique({
      where: { id: userId },
      select: { duesPaidThrough: true },
    })
  )?.duesPaidThrough ?? null

/** Everything a payment is allowed to touch, plus the one thing it isn't. */
const accountOf = () =>
  prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { role: true, joinedAt: true, active: true, slug: true },
  })

describe('GET /api/dues/status', () => {
  it('refuses to say anything to somebody who is not signed in', async () => {
    const response = await app.request('/api/dues/status')

    expect(response.status).toBe(401)
  })

  it('reports the prices the server would actually charge', async () => {
    const cookie = await signIn()

    const response = await app.request('/api/dues/status', {
      headers: { cookie },
    })

    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      plans: { plan: string; amountCents: number; covers: unknown[] }[]
      membership: { status: string }
    }

    const semester = body.plans.find((plan) => plan.plan === 'SEMESTER')
    const year = body.plans.find((plan) => plan.plan === 'YEAR')

    // Read from configuration, never written into the page: a treasurer
    // changing the price is one line in `.env`, and the number the member is
    // shown has to be the number they are charged.
    expect(semester?.amountCents).toBe(env.DUES_SEMESTER_CENTS)
    expect(year?.amountCents).toBe(env.DUES_YEAR_CENTS)

    // A year is two dues-bearing terms, with the free summer skipped.
    expect(semester?.covers).toHaveLength(1)
    expect(year?.covers).toHaveLength(2)
  })

  it('says whether payments are switched on at all', async () => {
    const cookie = await signIn()

    const response = await app.request('/api/dues/status', {
      headers: { cookie },
    })

    expect(await response.json()).toMatchObject({
      paymentsEnabled: stripeConfigured,
    })
  })
})

describe('POST /api/dues/checkout', () => {
  it('refuses somebody who is not signed in', async () => {
    expect((await post('/api/dues/checkout', { plan: 'SEMESTER' })).status).toBe(
      401,
    )
  })

  /**
   * A payment that would not move the date is a payment that buys nothing.
   *
   * `coverageFor` walks past terms already held and gives up after four hops —
   * beyond that it returns the member's own date, so the charge lands and the
   * membership is exactly as long as it was. Reachable in real life: the
   * faculty advisor and any non-student mentor are documented as wanting a
   * far-future `duesPaidThrough` so the gate never touches them.
   *
   * Worth a test rather than a comment because the two halves of this page
   * disagreed about it — claiming has always refused somebody already covered,
   * and the half that took money was the lax one. Runs before the Stripe check
   * below on purpose: the refusal happens whether or not the club has keys.
   */
  it('refuses a payment that would not extend anything', async () => {
    const cookie = await signIn()
    await prisma.user.update({
      where: { id: userId },
      data: { duesPaidThrough: new Date('2099-01-01T00:00:00') },
    })

    const response = await post('/api/dues/checkout', { plan: 'SEMESTER' }, { cookie })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('nothing to pay for'),
    })
    // And nothing was written on the way to refusing.
    expect(await prisma.duesPayment.count({ where: { userId } })).toBe(0)
  })

  it('turns down a plan it does not sell', async () => {
    const cookie = await signIn()

    const response = await post(
      '/api/dues/checkout',
      { plan: 'LIFETIME' },
      { cookie },
    )

    expect(response.status).toBe(400)
  })

  /**
   * Unconfigured Stripe is a supported state, like an unconfigured Postmark:
   * the club has to be able to run the site before somebody has made keys, and
   * dues were collected in person for the whole life of the previous site.
   * A 503 with a sentence is what the page turns into "ask an officer".
   */
  it.runIf(!stripeConfigured)(
    'says so plainly when the club has no Stripe keys yet',
    async () => {
      const cookie = await signIn()

      const response = await post(
        '/api/dues/checkout',
        { plan: 'SEMESTER' },
        { cookie },
      )

      expect(response.status).toBe(503)
      expect(await prisma.duesPayment.count({ where: { userId } })).toBe(0)
    },
  )
})

describe('crediting a payment', () => {
  const through = new Date('2026-12-13T23:59:59')

  it('extends membership to the date the payment was sold against', async () => {
    await pendingPayment(through)

    const result = await applyPayment({
      id: INTENT,
      status: 'succeeded',
      amount: env.DUES_SEMESTER_CENTS,
    })

    expect(result.status).toBe('SUCCEEDED')
    expect((await paidThroughOf())?.getTime()).toBe(through.getTime())
  })

  /**
   * The invariant the whole design is built around. The webhook and the
   * confirm-return path both land here for the same payment, and Stripe will
   * re-deliver besides — three calls must buy one semester.
   */
  it('credits the same payment once however many times it arrives', async () => {
    await pendingPayment(through)

    const succeeded = {
      id: INTENT,
      status: 'succeeded',
      amount: env.DUES_SEMESTER_CENTS,
    }

    await applyPayment(succeeded)
    await applyPayment(succeeded)
    await applyPayment(succeeded)

    expect((await paidThroughOf())?.getTime()).toBe(through.getTime())
    expect(
      await prisma.duesPayment.count({
        where: { userId, status: 'SUCCEEDED' },
      }),
    ).toBe(1)
  })

  /**
   * The receipt the member is actually shown.
   *
   * Stripe emails one automatically in live mode only, and only when the
   * account has "Successful payments" switched on — never for a test payment.
   * So the hosted receipt is the one the club can promise, and it has to
   * survive on the row rather than only existing on the screen that appeared
   * once.
   */
  it('stores the hosted receipt so it can be found again later', async () => {
    await pendingPayment(through)
    const receipt = 'https://pay.stripe.com/receipts/test-fixture'

    const result = await applyPayment({
      id: INTENT,
      status: 'succeeded',
      amount: env.DUES_SEMESTER_CENTS,
      receiptUrl: receipt,
    })

    expect(result.receiptUrl).toBe(receipt)
    expect(
      (
        await prisma.duesPayment.findUnique({
          where: { stripePaymentIntentId: INTENT },
          select: { receiptUrl: true },
        })
      )?.receiptUrl,
    ).toBe(receipt)
  })

  /**
   * A re-delivery that arrives without one must not blank the receipt already
   * on file. Stripe's own events carry `latest_charge` as a bare id, so this is
   * the ordinary case rather than a strange one.
   */
  it('keeps a receipt it already has when a later delivery carries none', async () => {
    await pendingPayment(through)
    const receipt = 'https://pay.stripe.com/receipts/test-fixture'

    await applyPayment({
      id: INTENT,
      status: 'succeeded',
      amount: env.DUES_SEMESTER_CENTS,
      receiptUrl: receipt,
    })
    await applyPayment({
      id: INTENT,
      status: 'succeeded',
      amount: env.DUES_SEMESTER_CENTS,
    })

    expect(
      (
        await prisma.duesPayment.findUnique({
          where: { stripePaymentIntentId: INTENT },
          select: { receiptUrl: true },
        })
      )?.receiptUrl,
    ).toBe(receipt)
  })

  /** Two payments landing out of order must not let the earlier one win. */
  it('never moves membership backwards', async () => {
    const later = new Date('2027-05-05T23:59:59')
    await prisma.user.update({
      where: { id: userId },
      data: { duesPaidThrough: later },
    })
    await pendingPayment(through)

    await applyPayment({
      id: INTENT,
      status: 'succeeded',
      amount: env.DUES_SEMESTER_CENTS,
    })

    expect((await paidThroughOf())?.getTime()).toBe(later.getTime())
  })

  /**
   * Stripe should never report less than was asked for. The row written at
   * checkout exists precisely so that it can be checked rather than assumed.
   */
  it('will not credit a payment smaller than the one it sold', async () => {
    await pendingPayment(through)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await applyPayment({ id: INTENT, status: 'succeeded', amount: 1 })

    expect(result.status).toBe('FAILED')
    expect(await paidThroughOf()).toBeNull()
    consoleError.mockRestore()
  })

  /**
   * An intent this server never created — a key shared with something else, or
   * a replayed event from another integration. There is no row saying who it
   * belongs to or what it bought, so nothing is granted to anybody.
   */
  it('grants nothing for an intent it has no record of', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await applyPayment({
      id: 'pi_never_created_here',
      status: 'succeeded',
      amount: 5_000,
    })

    expect(result.paidThrough).toBeNull()
    expect(await paidThroughOf()).toBeNull()
    consoleWarn.mockRestore()
  })

  it('records a failure without granting anything', async () => {
    await pendingPayment(through)

    const result = await applyPayment({
      id: INTENT,
      status: 'requires_payment_method',
    })

    expect(result.status).toBe('PENDING')
    expect(await paidThroughOf()).toBeNull()
  })

  /**
   * Stripe's events are not ordered. A `processing` delivered late must not
   * undo the `succeeded` that already landed.
   */
  it('does not walk a succeeded payment backwards on a late event', async () => {
    await pendingPayment(through)

    await applyPayment({
      id: INTENT,
      status: 'succeeded',
      amount: env.DUES_SEMESTER_CENTS,
    })
    await applyPayment({ id: INTENT, status: 'processing' })

    expect(
      (
        await prisma.duesPayment.findUnique({
          where: { stripePaymentIntentId: INTENT },
          select: { status: true },
        })
      )?.status,
    ).toBe('SUCCEEDED')
    expect((await paidThroughOf())?.getTime()).toBe(through.getTime())
  })
})

/**
 * The rule on its own, with no database in the way.
 *
 * Worth testing separately from the transaction because what it *declines* to
 * do is most of the point, and two of those — never demoting an officer, never
 * inventing a public profile — are the kind of thing that would go unnoticed
 * for a term if it broke.
 */
describe('what a payment changes about an account', () => {
  const now = new Date('2035-09-01T12:00:00')

  const account = (
    overrides: Partial<{
      role: UserRole
      joinedAt: Date | null
      active: boolean
    }> = {},
  ) => ({ role: UserRole.GUEST, joinedAt: null, active: true, ...overrides })

  it('turns a signup into a member and dates the membership', () => {
    expect(membershipUpdateFor(account(), now)).toEqual({
      role: UserRole.MEMBER,
      joinedAt: now,
    })
  })

  /**
   * The one that would be expensive. An officer settling their own dues through
   * the same page as everybody else must not come out the other side demoted to
   * MEMBER and locked out of the officer desks.
   */
  it('never demotes anybody who already holds a role', () => {
    for (const role of [UserRole.ADMIN, UserRole.OFFICER, UserRole.MEMBER]) {
      expect(membershipUpdateFor(account({ role }), now).role).toBeUndefined()
    }
  })

  /**
   * Only alongside the promotion. Stamping today onto somebody who has been on
   * the roster for two years would print a false year on their public profile.
   */
  it('does not date somebody who was already a member', () => {
    expect(
      membershipUpdateFor(account({ role: UserRole.MEMBER }), now).joinedAt,
    ).toBeUndefined()
  })

  it('brings somebody who had been marked inactive back', () => {
    expect(membershipUpdateFor(account({ active: false }), now).active).toBe(
      true,
    )
    expect(membershipUpdateFor(account(), now).active).toBeUndefined()
  })

  /**
   * A slug plus a non-GUEST role is what puts a name and a photo on the public
   * roster. Paying $25 is not consent to be published, so the only way to get
   * one stays an officer typing it.
   */
  it('never invents a public profile', () => {
    expect(Object.keys(membershipUpdateFor(account(), now))).not.toContain(
      'slug',
    )
  })
})

describe('promoting on payment', () => {
  const through = new Date('2026-12-13T23:59:59')

  const succeeded = {
    id: INTENT,
    status: 'succeeded',
    amount: env.DUES_SEMESTER_CENTS,
  }

  it('makes a member of the signup who paid, and says so', async () => {
    await pendingPayment(through)

    const result = await applyPayment(succeeded)

    expect(result.changed.role).toBe(UserRole.MEMBER)

    const account = await accountOf()
    expect(account.role).toBe(UserRole.MEMBER)
    expect(account.joinedAt).not.toBeNull()
    // Promoted, not published: the roster wants a slug as well, and that is
    // still an officer's to give.
    expect(account.slug).toBeNull()
  })

  /**
   * Same invariant as the crediting itself. The webhook and the browser's
   * `/dues/sync` both land here for one payment, and Stripe re-delivers besides
   * — the promotion has to be as once-only as the semester is.
   */
  it('promotes once however many times the payment arrives', async () => {
    await pendingPayment(through)

    const first = await applyPayment(succeeded)
    const second = await applyPayment(succeeded)
    const third = await applyPayment(succeeded)

    expect(first.changed.role).toBe(UserRole.MEMBER)
    // The later passes report nothing because they changed nothing — the
    // account is already where the first one put it.
    expect(second.changed).toEqual({})
    expect(third.changed).toEqual({})
    expect((await accountOf()).role).toBe(UserRole.MEMBER)
  })

  it('leaves an officer an officer', async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { role: UserRole.OFFICER },
    })
    await pendingPayment(through)

    const result = await applyPayment(succeeded)

    expect(result.changed.role).toBeUndefined()
    expect((await accountOf()).role).toBe(UserRole.OFFICER)
  })

  /** A renewal is not a second joining. */
  it('does not re-date a member who is renewing', async () => {
    const joined = new Date('2035-08-20T00:00:00')
    await prisma.user.update({
      where: { id: userId },
      data: { role: UserRole.MEMBER, joinedAt: joined },
    })
    await pendingPayment(through)

    await applyPayment(succeeded)

    expect((await accountOf()).joinedAt?.getTime()).toBe(joined.getTime())
  })

  /** Nothing is granted for a payment that did not go through. */
  it('changes nothing when the payment failed', async () => {
    await pendingPayment(through)

    const result = await applyPayment({
      id: INTENT,
      status: 'requires_payment_method',
    })

    expect(result.changed).toEqual({})
    expect((await accountOf()).role).toBe(UserRole.GUEST)
  })

  /**
   * The amount check runs before the transaction, so a short payment must not
   * buy a promotion either — it is the one path where the row exists and the
   * money does not match it.
   */
  it('changes nothing for a payment smaller than the one it sold', async () => {
    await pendingPayment(through)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await applyPayment({ id: INTENT, status: 'succeeded', amount: 1 })

    expect(result.changed).toEqual({})
    expect((await accountOf()).role).toBe(UserRole.GUEST)
    consoleError.mockRestore()
  })
})

/**
 * Claiming the free summer or the gap between terms.
 *
 * Against the real database, because the whole feature is one write: claiming
 * moves `duesPaidThrough` to the day the billable term opens, and there is no
 * second table to consult. That is what makes it flow through everything that
 * already reads that date.
 *
 * The clock is stubbed to a date the fallback calendar puts in the summer —
 * `fetch` is already failing for the whole file, so every term is the fixed
 * fallback and summer 2035 runs 18 May to 7 August. 2035 because `testing.md`
 * pins fixtures to a year nothing real uses.
 */
describe('POST /api/dues/activate', () => {
  const inSummer = new Date('2035-06-20T12:00:00')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(inSummer)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const activate = async (cookie: string) =>
    app.request('/api/dues/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: '{}',
    })

  it('refuses somebody who is not signed in', async () => {
    const response = await app.request('/api/dues/activate', { method: 'POST' })

    expect(response.status).toBe(401)
    expect(await paidThroughOf()).toBeNull()
  })

  it('turns a free summer into an active membership, with no money involved', async () => {
    const cookie = await signIn()

    const response = await activate(cookie)

    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      membership: { status: string; freeActive: boolean; canActivate: boolean }
    }

    expect(body.membership.status).toBe('ACTIVE')
    // Active without a payment behind it, which is the whole reason the chip
    // says ACTIVE rather than PAID.
    expect(body.membership.freeActive).toBe(true)
    expect(body.membership.canActivate).toBe(false)
    // And nothing was charged: no payment row, at any status.
    expect(await prisma.duesPayment.count({ where: { userId } })).toBe(0)
  })

  /**
   * The date is the day the window *shuts* — three weeks into the term ahead.
   *
   * It used to be that term's first day, which was right while the weeks
   * after it were free for everybody regardless: the claim only had to carry
   * somebody as far as the blanket trial. Nothing is blanket now, so a claim
   * that stopped on the first day would buy less than doing nothing used to.
   */
  it('moves the date to the day the free window shuts', async () => {
    const cookie = await signIn()

    await activate(cookie)

    const windowEnd = trialEndsAt(await getTerm(2035, Season.FALL))
    expect(windowEnd).not.toBeNull()
    expect((await paidThroughOf())?.getTime()).toBe(windowEnd!.getTime())
  })

  it('is idempotent, and never walks the date backwards', async () => {
    const cookie = await signIn()

    await activate(cookie)
    const first = await paidThroughOf()

    // The second and third are refused as already active rather than writing
    // again — there is nothing left to claim.
    expect((await activate(cookie)).status).toBe(409)
    expect((await activate(cookie)).status).toBe(409)

    expect((await paidThroughOf())?.getTime()).toBe(first?.getTime())
  })

  /** And it is what `GET /status` reports from then on. */
  it('is what the status route reports from then on', async () => {
    const cookie = await signIn()

    const membershipAt = async () => {
      const response = await app.request('/api/dues/status', {
        headers: { cookie },
      })
      return ((await response.json()) as { membership: unknown }).membership
    }

    expect(await membershipAt()).toMatchObject({
      status: 'FREE',
      canActivate: true,
      freeActive: false,
    })

    await activate(cookie)

    expect(await membershipAt()).toMatchObject({
      status: 'ACTIVE',
      canActivate: false,
      freeActive: true,
    })
  })

  /**
   * A claim must not be mistaken for cover when the member goes on to pay: the
   * plans still start at the fall, and paying carries the date to the end of it.
   */
  it('leaves a real payment free to extend it properly', async () => {
    const cookie = await signIn()
    await activate(cookie)

    const fall = await getTerm(2035, Season.FALL)
    await pendingPayment(fall.endsAt)
    await applyPayment({
      id: INTENT,
      status: 'succeeded',
      amount: env.DUES_SEMESTER_CENTS,
    })

    expect((await paidThroughOf())?.getTime()).toBe(fall.endsAt.getTime())

    const response = await app.request('/api/dues/status', { headers: { cookie } })
    const body = (await response.json()) as {
      membership: { status: string; freeActive: boolean }
    }

    // Paid now, not merely claimed — and the panel needs that to be true or it
    // reads a claim back as "your dues are paid".
    expect(body.membership.status).toBe('ACTIVE')
    expect(body.membership.freeActive).toBe(false)
  })

  /**
   * Mid-term there is no free window, so there is nothing to claim. Refused on
   * the server's own clock — a browser that posted here anyway must not be able
   * to buy itself a semester for nothing.
   */
  it('refuses when dues are actually owed', async () => {
    // The clock moves *before* signing in, not after: a session is issued with
    // an expiry relative to now, so jumping three months forward afterwards
    // would expire it and this would answer 401 for the wrong reason.
    vi.setSystemTime(new Date('2035-09-30T12:00:00'))
    const cookie = await signIn()

    const response = await activate(cookie)

    expect(response.status).toBe(409)
    expect(await paidThroughOf()).toBeNull()
  })

  /**
   * Claiming promotes exactly as paying does.
   *
   * Joining the club for the free break *is* joining the club, and the two ways
   * of becoming covered have to leave the account in the same state — otherwise
   * somebody who turned up over the summer spends the year as a guest on their
   * own dashboard.
   */
  it('makes a member of the guest who claimed it', async () => {
    const cookie = await signIn()

    await activate(cookie)

    const account = await accountOf()
    expect(account.role).toBe(UserRole.MEMBER)
    expect(account.joinedAt).not.toBeNull()
    // Promoted, not published — the roster still wants a slug an officer sets.
    expect(account.slug).toBeNull()
  })

  /** And it never overwrites a role somebody was given. */
  it('leaves an officer an officer', async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { role: UserRole.OFFICER },
    })
    const cookie = await signIn()

    await activate(cookie)

    expect((await accountOf()).role).toBe(UserRole.OFFICER)
  })
})

describe('POST /api/stripe/webhook', () => {
  const through = new Date('2026-12-13T23:59:59')

  /**
   * A delivery signed with the club's real webhook secret.
   *
   * `generateTestHeaderString` is Stripe's own helper for exactly this: it
   * produces a genuine signature over these exact bytes, so the handler runs
   * its real verification rather than having it stubbed out. Testing this any
   * other way would test nothing — signature checking *is* the authentication
   * on this route.
   */
  function signed(event: unknown, timestamp?: number) {
    const payload = JSON.stringify(event)

    const signature = stripe!.webhooks.generateTestHeaderString({
      payload,
      secret: env.STRIPE_WEBHOOK_SECRET!,
      ...(timestamp === undefined ? {} : { timestamp }),
    })

    return app.request('/api/stripe/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': signature,
      },
      body: payload,
    })
  }

  const succeeded = (amount = env.DUES_SEMESTER_CENTS) => ({
    id: 'evt_test_dues',
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: INTENT,
        status: 'succeeded',
        amount,
        amount_received: amount,
      },
    },
  })

  /**
   * An unsigned delivery is a form anybody on the internet can fill in to grant
   * themselves membership. It is refused whether or not a secret is configured
   * — 400 when there is one to check against, 503 when there is not.
   */
  it('never credits a delivery it cannot verify', async () => {
    await pendingPayment(through)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await post('/api/stripe/webhook', succeeded())

    expect([400, 503]).toContain(response.status)
    expect(await paidThroughOf()).toBeNull()
    consoleError.mockRestore()
  })

  /**
   * The whole reason the webhook exists: a member who pays and closes the tab
   * before the confirm returns is credited by this and by nothing else.
   * `/dues/sync` is deliberately never called in this test.
   */
  it.runIf(webhooksConfigured)(
    'credits a payment from a signed delivery alone',
    async () => {
      await pendingPayment(through)

      const response = await signed(succeeded())

      expect(response.status).toBe(200)
      expect((await paidThroughOf())?.getTime()).toBe(through.getTime())
      // The promotion rides along on this path too. It has to: this member
      // closed the tab and will never call `/dues/sync`, so anything left in
      // that route rather than in `applyPayment` would never happen to them.
      expect((await accountOf()).role).toBe(UserRole.MEMBER)
    },
  )

  /** Signed, delivered twice — as Stripe does on any retry. One semester. */
  it.runIf(webhooksConfigured)(
    'credits it once however many times Stripe re-delivers',
    async () => {
      await pendingPayment(through)

      await signed(succeeded())
      await signed(succeeded())
      await signed(succeeded())

      expect((await paidThroughOf())?.getTime()).toBe(through.getTime())
      expect(
        await prisma.duesPayment.count({
          where: { userId, status: 'SUCCEEDED' },
        }),
      ).toBe(1)
    },
  )

  /**
   * The signature covers the bytes, so changing the amount after signing has to
   * invalidate it. This is the attack the secret exists to stop: a captured
   * delivery, edited to name somebody else's payment or a bigger one.
   */
  it.runIf(webhooksConfigured)('refuses a body edited after signing', async () => {
    await pendingPayment(through)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const payload = JSON.stringify(succeeded())
    const signature = stripe!.webhooks.generateTestHeaderString({
      payload,
      secret: env.STRIPE_WEBHOOK_SECRET!,
    })

    const response = await app.request('/api/stripe/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': signature,
      },
      // One character different from what was signed.
      body: payload.replace('"status":"succeeded"', '"status":"SUCCEEDED"'),
    })

    expect(response.status).toBe(400)
    expect(await paidThroughOf()).toBeNull()
    consoleError.mockRestore()
  })

  /**
   * The signature carries a timestamp and Stripe's verification enforces a
   * tolerance on it, so a delivery captured off the wire cannot be replayed
   * tomorrow to buy another semester.
   */
  it.runIf(webhooksConfigured)('refuses a delivery too old to be genuine', async () => {
    await pendingPayment(through)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const anHourAgo = Math.floor(Date.now() / 1000) - 3600
    const response = await signed(succeeded(), anHourAgo)

    expect(response.status).toBe(400)
    expect(await paidThroughOf()).toBeNull()
    consoleError.mockRestore()
  })

  /**
   * Answered 200 and dropped. Anything else and Stripe retries it for three
   * days, which turns every event type this site has no opinion about into a
   * standing alarm.
   */
  it.runIf(webhooksConfigured)(
    'accepts an event it has no opinion about without acting on it',
    async () => {
      await pendingPayment(through)

      const response = await signed({
        id: 'evt_test_unrelated',
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_test' } },
      })

      expect(response.status).toBe(200)
      expect(await paidThroughOf()).toBeNull()
    },
  )

  /**
   * A card that needs the bank's authentication step sits at `requires_action`
   * until somebody completes it. Crediting there would hand out a semester for
   * a payment that may never be made.
   */
  it.runIf(webhooksConfigured)(
    'grants nothing while a payment is still waiting on the bank',
    async () => {
      await pendingPayment(through)

      const response = await signed({
        id: 'evt_test_pending',
        type: 'payment_intent.processing',
        data: {
          object: { id: INTENT, status: 'requires_action', amount: 2500 },
        },
      })

      expect(response.status).toBe(200)
      expect(await paidThroughOf()).toBeNull()
      expect(
        (
          await prisma.duesPayment.findUnique({
            where: { stripePaymentIntentId: INTENT },
            select: { status: true },
          })
        )?.status,
      ).toBe('PENDING')
    },
  )
})
