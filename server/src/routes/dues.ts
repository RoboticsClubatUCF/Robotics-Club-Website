import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { prisma } from '../db.js'
import {
  DuesPaymentStatus,
  DuesPlan,
  UserRole,
} from '../generated/prisma/enums.js'
import { rateLimit } from '../rateLimit.js'
import {
  type Coverage,
  type MembershipStanding,
  type Term,
  coverageFor,
  membershipStanding,
  priceOf,
} from '../semester.js'
import { type AuthEnv, originGuard, requireAuth } from '../session.js'
import { stripe, stripeConfigured } from '../stripe.js'

/**
 * Dues: what somebody owes, and how they pay it.
 *
 *   GET  /api/dues/status              -> where this member stands, and prices
 *   POST /api/dues/checkout { plan }   -> a Stripe payment intent to pay it
 *   POST /api/dues/sync     { ... }    -> ask Stripe how one turned out
 *   POST /api/dues/activate            -> claim the free summer or break
 *
 * Two rules run through all of it.
 *
 * **The browser never names a price or a date.** Both are computed here, from
 * configuration and from UCF's calendar, and both are frozen onto the payment
 * row before the intent is created. A client that could send `amountCents`
 * could buy a year for a penny, and one that could send `coversThrough` could
 * buy a decade.
 *
 * **Money is only ever credited from Stripe's own account of it.** Nothing here
 * takes the browser's word that a payment succeeded — `sync` asks Stripe about
 * the intent, and the webhook is Stripe telling us unprompted. Both funnel into
 * one `applyPayment`, which is idempotent because the two of them routinely
 * race on a fast card.
 *
 * **Paying is what turns a signup into a member.** A first payment moves the
 * account off `GUEST` and stamps `joinedAt`, in the same transaction that moves
 * the date — see `membershipUpdateFor`. It stops well short of publishing
 * anybody: a public roster profile still needs a `slug`, and that stays an
 * officer's decision.
 */
export const dues = new Hono<AuthEnv>()

/**
 * Two budgets, split the same way signup splits its own.
 *
 * `writes` guards checkout, which creates an object at Stripe. Ten rather than
 * the site default of five, because changing plan, a declined card and a second
 * attempt are three intents for one member who has done nothing wrong.
 *
 * `checks` guards `sync`, which only *reads* — and which the page calls on
 * every return from a payment, on every reload of the dues page afterwards, and
 * twice over when a redirect and a confirm land together. Five of those is a
 * limit that bites the member it is meant to protect, and the one thing that
 * must never be rate-limited into failing is the call that credits a payment
 * somebody has already made.
 */
const writes = rateLimit('dues', 10)
const checks = rateLimit('dues-sync', 30)

const planSchema = z.object({ plan: z.enum(DuesPlan) })

const NOT_CONFIGURED =
  'Card payments are not switched on yet. Ask an officer how to pay your dues — nothing about your account is affected.'

function requireStripe(): NonNullable<typeof stripe> {
  if (!stripe) {
    // 503 rather than 500: nothing is broken, the club has not finished setting
    // it up. Both are the API's fault rather than the member's, and only one of
    // them is worth an alert.
    throw new HTTPException(503, { message: NOT_CONFIGURED })
  }

  return stripe
}

/** Terms go over the wire as plain dates plus the two words a page needs. */
const wireTerm = (term: Term) => ({
  year: term.year,
  season: term.season,
  startsAt: term.startsAt.toISOString(),
  endsAt: term.endsAt.toISOString(),
  /** False when UCF's calendar could not be read and these are the fallbacks. */
  fromCalendar: term.fromCalendar,
})

const wireCoverage = (coverage: Coverage) => ({
  covers: coverage.covers.map(wireTerm),
  through: coverage.through.toISOString(),
})

/** Two routes answer with this, and they must not describe it differently. */
const wireMembership = (standing: MembershipStanding) => ({
  status: standing.status,
  hasAccess: standing.hasAccess,
  duesRequired: standing.duesRequired,
  paidThrough: standing.paidThrough?.toISOString() ?? null,
  freeThrough: standing.freeThrough?.toISOString() ?? null,
  term: wireTerm(standing.term),
  billable: wireTerm(standing.billable),
  /** Active because a free window was claimed, not because anything was paid. */
  freeActive: standing.freeActive,
  /** A free window is running and has not been claimed yet. */
  canActivate: standing.canActivate,
})

// ------------------------------------------------------------------ status

/**
 * Everything the dues page and the dashboard need, in one call.
 *
 * The prices come from here rather than being written into the frontend for the
 * same reason the signup page asks how long its link lasts: they are this
 * server's configuration, and a page that hardcodes them is a page that lies
 * the first time a treasurer changes one.
 */
dues.get('/status', requireAuth, async (c) => {
  const user = c.get('user')
  const now = new Date()

  const standing = await membershipStanding(user.duesPaidThrough, now)

  // Both quoted against what this member already has, so somebody who buys a
  // second semester mid-term is shown the term it would actually extend into
  // rather than the one they are already paid for.
  const [semester, year] = await Promise.all([
    coverageFor('SEMESTER', now, user.duesPaidThrough),
    coverageFor('YEAR', now, user.duesPaidThrough),
  ])

  const history = await prisma.duesPayment.findMany({
    where: { userId: user.id, status: DuesPaymentStatus.SUCCEEDED },
    orderBy: { paidAt: 'desc' },
    take: 10,
    select: {
      id: true,
      plan: true,
      amountCents: true,
      termYear: true,
      termSeason: true,
      coversThrough: true,
      paidAt: true,
      receiptUrl: true,
    },
  })

  return c.json({
    membership: wireMembership(standing),
    plans: [
      {
        plan: DuesPlan.SEMESTER,
        amountCents: priceOf('SEMESTER'),
        ...wireCoverage(semester),
      },
      {
        plan: DuesPlan.YEAR,
        amountCents: priceOf('YEAR'),
        ...wireCoverage(year),
      },
    ],
    /** So the page can explain itself rather than showing a dead pay button. */
    paymentsEnabled: stripeConfigured,
    history: history.map((row) => ({
      ...row,
      coversThrough: row.coversThrough.toISOString(),
      paidAt: row.paidAt?.toISOString() ?? null,
    })),
  })
})

// ---------------------------------------------------------------- checkout

dues.post(
  '/checkout',
  originGuard,
  requireAuth,
  writes,
  zValidator('json', planSchema),
  async (c) => {
    const client = requireStripe()
    const user = c.get('user')
    const { plan } = c.req.valid('json')

    const now = new Date()
    const coverage = await coverageFor(plan, now, user.duesPaidThrough)
    const amountCents = priceOf(plan)

    // Everything below is computed, never received. The row is written before
    // the intent so there is a record of what this server intended to charge,
    // to compare against whatever Stripe eventually reports.
    const intent = await client.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      // Lets Stripe offer whatever the account has switched on — cards, and
      // wallets on the devices that have them — without this route having to
      // know which. `allow_redirects: 'always'` is what admits the ones that
      // bounce through a bank, which is why the page has a return URL.
      automatic_payment_methods: { enabled: true },
      // Metadata is how a payment in the Stripe dashboard is tied back to a
      // person here. Without it, a refund request six weeks later starts with
      // somebody reading card digits down a phone.
      metadata: {
        userId: user.id,
        plan,
        termYear: String(coverage.term.year),
        termSeason: coverage.term.season,
        coversThrough: coverage.through.toISOString(),
      },
      description: `RCCF dues — ${plan === DuesPlan.YEAR ? 'academic year' : 'one semester'} (${coverage.term.season} ${coverage.term.year})`,
      /**
       * Who Stripe would email a receipt to — which is not the same as somebody
       * being emailed one, and the difference has bitten once already.
       *
       * Stripe sends an automatic receipt only in **live** mode, and only when
       * "Successful payments" is switched on under Settings → Business →
       * Customer emails. For a test payment it never sends at all; the way to
       * get one is the Dashboard's manual "Send receipt", which this field
       * pre-fills. So this is worth setting and worth never promising.
       *
       * What the member is actually shown is `receiptUrl` — Stripe's hosted
       * receipt, which exists for every successful charge in both modes.
       */
      ...(user.email ? { receipt_email: user.email } : {}),
    })

    if (!intent.client_secret) {
      // Stripe has never done this, and if it ever does the alternative is a
      // page that renders an empty payment form with no explanation.
      throw new HTTPException(502, {
        message: 'Stripe did not return a usable payment. Please try again.',
      })
    }

    await prisma.duesPayment.create({
      data: {
        userId: user.id,
        plan,
        amountCents,
        currency: 'usd',
        status: DuesPaymentStatus.PENDING,
        stripePaymentIntentId: intent.id,
        termYear: coverage.term.year,
        termSeason: coverage.term.season,
        coversThrough: coverage.through,
      },
    })

    return c.json({
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
      plan,
      amountCents,
      ...wireCoverage(coverage),
    })
  },
)

// ---------------------------------------------------------------- activate

/**
 * Claim the free window — the summer, or the gap between one term and the next.
 *
 * Nothing is charged and nothing is granted that the member did not already
 * have: `membershipStanding` gives everybody `hasAccess` through a free window
 * because that is the club's rule. What this changes is what the membership
 * *reads* as, and it leaves the club a list of who is actually around over a
 * break instead of a roster of everyone who has ever signed up.
 *
 * A button rather than a job. The alternative — flipping the whole roster at
 * the start of every summer and again at every mid-year break — is two mass
 * writes a year across every user row, and it would be writing about hundreds
 * of people to learn something true of a couple of dozen.
 *
 * The window is worked out from this server's clock. A term the browser could
 * name is a term the browser could pick, and the row is only worth having if it
 * says which period somebody actually turned up for.
 */
dues.post('/activate', originGuard, requireAuth, writes, async (c) => {
  const user = c.get('user')
  const standing = await claimFreeWindow(user)


  console.log(
    `dues: ${user.id} activated for the free run-up to ${standing.billable.season} ${standing.billable.year}`,
  )

  return c.json({ membership: wireMembership(standing) })
})

// -------------------------------------------------------------------- sync

const syncSchema = z.object({
  paymentIntentId: z.string().trim().min(1).max(255),
})

/**
 * Ask Stripe how a payment turned out, and credit it if it worked.
 *
 * This is what the dues page calls when the member lands back on it, and it is
 * not a shortcut around the webhook — it asks Stripe the same question from the
 * other direction. The browser supplies only *which* intent to look at, and an
 * intent belonging to somebody else is refused on the row this server wrote at
 * checkout, so naming a stranger's payment buys nothing.
 *
 * It exists because the webhook cannot be relied on to have arrived yet — it is
 * a separate delivery over the public internet, and in development there may be
 * no tunnel for it at all. Without this, paying with a card that needs no
 * further authentication leaves the member looking at a page that still says
 * they owe $25.
 */
dues.post(
  '/sync',
  originGuard,
  requireAuth,
  checks,
  zValidator('json', syncSchema),
  async (c) => {
    const client = requireStripe()
    const user = c.get('user')
    const { paymentIntentId } = c.req.valid('json')

    const payment = await prisma.duesPayment.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
      select: { id: true, userId: true },
    })

    // One answer for "no such payment" and "somebody else's payment", so this
    // cannot be used to find out which intent ids exist.
    if (!payment || payment.userId !== user.id) {
      throw new HTTPException(404, { message: 'No such payment.' })
    }

    // Expanded, so the hosted receipt comes back in the same call rather than
    // costing a second one inside `applyPayment`.
    const intent = await client.paymentIntents.retrieve(paymentIntentId, {
      expand: ['latest_charge'],
    })
    const charge = intent.latest_charge

    const result = await applyPayment({
      ...intent,
      receiptUrl:
        typeof charge === 'object' && charge ? (charge.receipt_url ?? null) : null,
    })

    return c.json({
      status: result.status,
      paidThrough: result.paidThrough?.toISOString() ?? null,
      receiptUrl: result.receiptUrl,
    })
  },
)

// ------------------------------------------------------------------ apply

/** How Stripe's intent statuses map onto the ones worth storing. */
function statusOf(intent: {
  status: string
}): (typeof DuesPaymentStatus)[keyof typeof DuesPaymentStatus] {
  switch (intent.status) {
    case 'succeeded':
      return DuesPaymentStatus.SUCCEEDED
    case 'canceled':
      return DuesPaymentStatus.CANCELED
    // `requires_payment_method` after an attempt means the last one was
    // declined; before any attempt it is simply a fresh intent. Both are things
    // the member can still act on, so neither is a final failure.
    case 'requires_payment_method':
    case 'requires_confirmation':
    case 'requires_action':
    case 'processing':
      return DuesPaymentStatus.PENDING
    default:
      return DuesPaymentStatus.FAILED
  }
}

export interface ApplyResult {
  status: (typeof DuesPaymentStatus)[keyof typeof DuesPaymentStatus]
  paidThrough: Date | null
  /** Stripe's hosted receipt, once there is a successful charge to have one. */
  receiptUrl: string | null
  /**
   * What else about the account this pass changed — empty for a renewal, and
   * empty for every re-delivery of a payment already credited.
   */
  changed: MembershipUpdate
}

// -------------------------------------------------- what paying makes you

/** The fields of an account a successful payment is allowed to touch. */
export interface MembershipUpdate {
  role?: UserRole
  joinedAt?: Date
  active?: boolean
}

/**
 * What a payment changes about the person who made it, beyond the date.
 *
 * Three rules, and what each of them deliberately does *not* do is the reason
 * this is a function with a test rather than three lines inside the
 * transaction.
 *
 * **Only `GUEST` is promoted.** Every other role is one an officer chose, and a
 * payment must never overwrite that — least of all by quietly demoting an
 * `OFFICER` to `MEMBER` because they settled their own dues. `ALUMNUS` is left
 * alone for the same reason and costs nothing: access is decided by
 * `membershipStanding`, which reads the date, so an alumnus who pays is covered
 * whatever their role says.
 *
 * **`joinedAt` is stamped only alongside that promotion.** This payment is the
 * moment a signup became a member, so today is the right answer for them. For
 * anybody already on the roster a null date means the club never recorded
 * theirs, and today is the wrong answer — it would print a false year on a
 * public profile page.
 *
 * **No slug is ever generated.** `slug` plus a non-`GUEST` role is what puts a
 * name and a photo on the public roster, and publishing a person because they
 * paid $25 is a decision for a human. Promotion gets somebody their dashboard;
 * an officer still gives them a profile.
 */
export function membershipUpdateFor(
  user: { role: UserRole; joinedAt: Date | null; active: boolean },
  now: Date,
): MembershipUpdate {
  const update: MembershipUpdate = {}

  if (user.role === UserRole.GUEST) {
    update.role = UserRole.MEMBER
    if (user.joinedAt === null) update.joinedAt = now
  }

  // Somebody the club marked inactive who has just paid for a term has come
  // back, and `active` is only ever the roster's current/alumni split — there
  // is no "barred" state for it to undo.
  if (!user.active) update.active = true

  return update
}

/**
 * The hosted receipt for a payment intent, or null if it cannot be had.
 *
 * A `payment_intent.succeeded` webhook carries `latest_charge` as a bare id, so
 * the URL takes one more call to Stripe. Best-effort on purpose: the money is
 * the point and the link is a courtesy, so a failure here must never stop a
 * payment being credited.
 */
export async function receiptUrlFor(
  intentId: string,
): Promise<string | null> {
  if (!stripe) return null

  try {
    const intent = await stripe.paymentIntents.retrieve(intentId, {
      expand: ['latest_charge'],
    })
    const charge = intent.latest_charge

    return typeof charge === 'object' && charge ? (charge.receipt_url ?? null) : null
  } catch (error) {
    console.error(`dues: could not read the receipt for ${intentId}`, error)
    return null
  }
}

/**
 * Claim the free window by moving `duesPaidThrough` to the day it closes.
 *
 * The other of the two functions that move that date, and they live together on
 * purpose: it is the single field that says whether anybody is covered, and two
 * writers of it a file apart is how they end up disagreeing.
 *
 * **The date is the first day of the billable term**, not the end of the free
 * trial that follows it. Three things fall out of that, and all three are the
 * reason it is that date rather than a fortnight later:
 *
 *   - The trial goes on working. When the term opens, cover lapses and
 *     `stillFree` takes over, so a member who claimed the summer gets the same
 *     two free weeks in September as everybody else instead of having them
 *     silently swallowed.
 *   - The trial-closing DM still finds them. That sweep takes everybody whose
 *     `duesPaidThrough` is null or past, and this date is a fortnight past by
 *     the time it runs — as it should be, because they have not paid.
 *   - `membershipStanding` can tell a claim from a payment by the date alone: a
 *     payment always reaches the *end* of a term, three months further on.
 *
 * Nothing here can move the date backwards. `canActivate` is only ever true for
 * somebody not currently covered, so their date is null or in the past and the
 * term ahead has not started — but the guard is stated rather than assumed.
 *
 * **It promotes exactly as paying does.** Claiming the free break is joining
 * the club for it, so a `GUEST` who presses the button comes out a `MEMBER` —
 * same `membershipUpdateFor`, same transaction, same refusal to touch a role an
 * officer chose or to invent a slug. The two ways of becoming covered must
 * leave the account in the same state or somebody who joined over the summer
 * spends the year as a guest on their own dashboard.
 */
export async function claimFreeWindow(
  user: { id: string; duesPaidThrough: Date | null },
  now: Date = new Date(),
): Promise<MembershipStanding> {
  const standing = await membershipStanding(user.duesPaidThrough, now)

  if (!standing.canActivate) {
    throw new HTTPException(409, {
      message: standing.freeActive
        ? 'Your membership is already active for this break.'
        : standing.status === 'ACTIVE'
          ? 'Your membership is already active.'
          : 'There is nothing to activate right now — dues are owed for this term.',
    })
  }

  const through = standing.billable.startsAt

  const changed = await prisma.$transaction(async (tx) => {
    // Scalars only, and one query — see the note in `applyPayment` about Prisma
    // fanning relation selects across a transaction's single connection.
    const row = await tx.user.findUnique({
      where: { id: user.id },
      select: {
        duesPaidThrough: true,
        role: true,
        joinedAt: true,
        active: true,
      },
    })

    // A second press that raced the first. Theirs did the work; this one
    // reports rather than repeating it, and the date never goes backwards.
    if (!row || (row.duesPaidThrough !== null && row.duesPaidThrough >= through)) {
      return {} as MembershipUpdate
    }

    const update = membershipUpdateFor(row, now)

    await tx.user.update({
      where: { id: user.id },
      data: { duesPaidThrough: through, ...update },
    })

    return update
  })

  if (changed.role) {
    console.log(
      `dues: ${user.id} claimed the free break and is now ${changed.role}. Still off the public roster — that needs a slug an officer sets.`,
    )
  }

  return membershipStanding(through, now)
}

/**
 * Record what Stripe says about an intent, and extend membership if it was
 * paid.
 *
 * The one function both the webhook and `sync` go through, and the only place
 * `duesPaidThrough` is ever moved forward.
 *
 * Crediting exactly once is the whole job. Stripe retries a webhook until
 * something answers 2xx, may deliver the same event twice regardless, and the
 * member's own browser calls `sync` at roughly the same moment — so the same
 * successful payment routinely arrives here two or three times. The guard is
 * the stored row's status: the transaction only extends membership on the pass
 * that moves it from something else to `SUCCEEDED`, and `updateMany` with that
 * status in the `where` makes the check and the write one statement that two
 * connections cannot both win.
 *
 * `coversThrough` is read off the row rather than recomputed, so a member who
 * paid in August gets the dates they were quoted in August even if UCF has
 * since revised the calendar.
 *
 * The rest of the account moves with the date, in the same transaction and on
 * the same pass — `membershipUpdateFor` decides what. Doing it here rather than
 * in the two callers is what keeps a member who closed the tab and was credited
 * by the webhook from ending up promoted differently to one whose browser got
 * there first.
 */
export async function applyPayment(intent: {
  id: string
  status: string
  amount?: number
  /** Stripe's hosted receipt, when the caller already has it to hand. */
  receiptUrl?: string | null
}): Promise<ApplyResult> {
  const status = statusOf(intent)

  const payment = await prisma.duesPayment.findUnique({
    where: { stripePaymentIntentId: intent.id },
    select: {
      id: true,
      userId: true,
      status: true,
      amountCents: true,
      coversThrough: true,
      receiptUrl: true,
    },
  })

  if (!payment) {
    // An intent this server never created. A live key shared with something
    // else, or a replayed event from another integration — either way there is
    // no row saying who it belongs to or what it bought, so nothing is granted.
    console.warn(`dues: payment intent ${intent.id} has no record here`)
    return { status, paidThrough: null, receiptUrl: null, changed: {} }
  }

  if (status !== DuesPaymentStatus.SUCCEEDED) {
    await prisma.duesPayment.updateMany({
      // Never walk a succeeded payment backwards. Stripe's events are not
      // ordered, so a `payment_intent.processing` delivered late must not undo
      // the `succeeded` that already landed.
      where: { id: payment.id, status: { not: DuesPaymentStatus.SUCCEEDED } },
      data: { status },
    })

    const user = await prisma.user.findUnique({
      where: { id: payment.userId },
      select: { duesPaidThrough: true },
    })

    return {
      status,
      paidThrough: user?.duesPaidThrough ?? null,
      receiptUrl: payment.receiptUrl,
      changed: {},
    }
  }

  // Whatever is already stored wins, then whatever the caller was able to look
  // up. `applyPayment` deliberately makes no call to Stripe itself: it is the
  // one function both the webhook and `sync` funnel through, and keeping the
  // network out of it is what lets the crediting rules be tested against a
  // plain object rather than a mocked SDK.
  const receiptUrl = payment.receiptUrl ?? intent.receiptUrl ?? null

  // Paid for less than the row says it was for. Stripe should never do this,
  // but the row exists precisely so that it can be checked rather than assumed.
  if (typeof intent.amount === 'number' && intent.amount < payment.amountCents) {
    console.error(
      `dues: intent ${intent.id} paid ${intent.amount} against an expected ${payment.amountCents} — not crediting`,
    )
    return {
      status: DuesPaymentStatus.FAILED,
      paidThrough: null,
      receiptUrl,
      changed: {},
    }
  }

  const credited = await prisma.$transaction(async function credit(
    tx,
  ): Promise<{ paidThrough: Date | null; changed: MembershipUpdate }> {
    const { count } = await tx.duesPayment.updateMany({
      where: { id: payment.id, status: { not: DuesPaymentStatus.SUCCEEDED } },
      data: {
        status: DuesPaymentStatus.SUCCEEDED,
        paidAt: new Date(),
        receiptUrl,
      },
    })

    // Scalars only, and one query. Asking for relations inside an interactive
    // transaction makes Prisma fan the selects out across the single connection
    // the transaction is holding, which the driver adapter warns about.
    const user = await tx.user.findUnique({
      where: { id: payment.userId },
      select: {
        duesPaidThrough: true,
        role: true,
        joinedAt: true,
        active: true,
      },
    })

    // Somebody else got here first. Their pass did the crediting *and* the
    // promotion; this one reports the result rather than doing either again.
    if (count === 0 || !user) {
      return { paidThrough: user?.duesPaidThrough ?? null, changed: {} }
    }

    const current = user.duesPaidThrough

    // Only ever forward. Two payments landing out of order must not let the
    // earlier one shorten what the later one bought.
    const extended =
      current !== null && current > payment.coversThrough
        ? current
        : payment.coversThrough

    const changed = membershipUpdateFor(user, new Date())

    await tx.user.update({
      where: { id: payment.userId },
      data: { duesPaidThrough: extended, ...changed },
    })

    return { paidThrough: extended, changed }
  })

  if (credited.changed.role) {
    // Worth a line of its own: this is the only thing on the site that changes
    // somebody's role without an officer doing it, and the log is where anyone
    // wondering why goes to look.
    console.log(
      `dues: ${payment.userId} paid and is now ${credited.changed.role}. Still off the public roster — that needs a slug an officer sets.`,
    )
  }

  return { status, ...credited, receiptUrl }
}
