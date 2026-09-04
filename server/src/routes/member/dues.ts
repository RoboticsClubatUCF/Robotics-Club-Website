import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { validate } from '../../core/validate.js'
import { prisma } from '../../core/db.js'
import { pushRoles } from '../../discord/discordRoles.js'
import {
  DuesPaymentStatus,
  DuesPlan,
  UserRole,
} from '../../generated/prisma/enums.js'
import { rateLimit } from '../../core/rateLimit.js'
import {
  type Coverage,
  type MembershipStanding,
  type Term,
  coverageFor,
  membershipStanding,
  priceOf,
} from '../../membership/semester.js'
import {
  type AuthEnv,
  type SessionUser,
  originGuard,
  requireAuth,
} from '../../auth/session.js'
import { stripe, stripeConfigured } from '../../payments/stripe.js'

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
 * The browser never names a price or a date. Both are computed here and frozen onto
 * the payment row before the intent is created — a client that could send
 * `amountCents` could buy a year for a penny.
 *
 * Money is only ever credited from Stripe's own account of it. `sync` asks Stripe
 * about the intent, the webhook is Stripe telling us unprompted, and both funnel
 * into one idempotent `applyPayment` because they routinely race on a fast card.
 *
 * Paying is what turns a signup into a member: a first payment moves the account off
 * `GUEST` and stamps `joinedAt` in the same transaction that moves the date. That
 * puts them in the headline count and hands them the Discord Members role; it isn't
 * what puts them on `/members`, which lists every account.
 *
 * The member survey used to gate both `checkout` and `activate`, which stopped the
 * club taking money from anybody who hadn't given it a shirt size. It's an
 * invitation now, and the only survey left here is the pair of flags
 * `wireMembership` sends so the dashboard knows whether it still has something to ask.
 */
export const dues = new Hono<AuthEnv>()

/**
 * Two budgets, split the way signup splits its own.
 *
 * `writes` guards checkout, which creates an object at Stripe. Ten rather than five,
 * because changing plan, a declined card and a second attempt are three intents for
 * one member who has done nothing wrong.
 *
 * `checks` guards `sync`, which only reads — and which the page calls on every
 * return from a payment and every reload afterwards. The one thing that must never
 * be rate-limited into failing is the call that credits a payment already made.
 */
const writes = rateLimit('dues', 10)
const checks = rateLimit('dues-sync', 30)

const planSchema = z.object({ plan: z.enum(DuesPlan) })

const NOT_CONFIGURED =
  'Card payments are not switched on yet. Ask an officer how to pay your dues — nothing about your account is affected.'

function requireStripe(): NonNullable<typeof stripe> {
  if (!stripe) {
    // 503 rather than 500: nothing is broken, the club hasn't finished setting it up.
    // Both are the API's fault rather than the member's, and only one is worth an alert.
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

/**
 * Two routes answer with this, and they must not describe it differently.
 *
 * It takes the user as well as the standing because of the two survey flags, which
 * aren't facts about dues. They ride here because `/dues/status` is the one call the
 * dashboard rail already makes on every page — a prompt with its own fetch would
 * arrive a beat late, under somebody's pointer. `membershipStanding` stays date-only.
 */
const wireMembership = (
  user: Pick<
    SessionUser,
    'role' | 'surveyCompletedAt' | 'surveyPromptDismissedAt'
  >,
  standing: MembershipStanding,
) => ({
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
  /**
   * The one-time member survey hasn't been answered.
   *
   * It locks nothing, and the name is chosen to stop it drifting back into meaning
   * that: it was `surveyRequired` while `requireSurvey` existed and five pages drew a
   * padlock from it. Nothing on the server refuses an unanswered survey now, so this
   * is only what the dashboard reads to decide whether it has something to offer.
   *
   * No `ADMIN` exemption, unlike everything else here — with no lock left there's
   * nothing to be exempt from.
   */
  surveyPending: user.surveyCompletedAt === null,
  /**
   * They ticked *don't ask me again*, so the prompt stays down.
   *
   * Separate from the flag above because the two drive different things: the prompt
   * reads both, the panels that offer the form read only the first. A dismissal hides
   * the nag, not the survey.
   */
  surveyPromptDismissed: user.surveyPromptDismissedAt !== null,
})

// ------------------------------------------------------------------ status

/**
 * Everything the dues page and the dashboard need, in one call.
 *
 * The prices come from here rather than the frontend for the reason the signup page
 * asks how long its link lasts: they're this server's configuration, and a page that
 * hardcodes them lies the first time a treasurer changes one.
 */
dues.get('/status', requireAuth, async (c) => {
  const user = c.get('user')
  const now = new Date()

  const standing = await membershipStanding(user.duesPaidThrough, now)

  // Both quoted against what this member already has, so somebody buying a second
  // semester mid-term is shown the term it would actually extend into.
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
      // Who comped it, null for everything Stripe collected. A zero-amount row with
      // no explanation reads as a bug in the price column.
      grantedBy: { select: { fullName: true } },
    },
  })

  return c.json({
    membership: wireMembership(user, standing),
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
    history: history.map(({ grantedBy, ...row }) => ({
      ...row,
      coversThrough: row.coversThrough.toISOString(),
      paidAt: row.paidAt?.toISOString() ?? null,
      // Flattened to the name: the page prints "Granted by Alex Chen" and has no use
      // for an object. This is the shape `ApiDuesStatus` mirrors.
      grantedBy: grantedBy?.fullName ?? null,
    })),
  })
})

// ---------------------------------------------------------------- checkout

dues.post(
  '/checkout',
  originGuard,
  requireAuth,
  writes,
  validate('json', planSchema),
  async (c) => {
    const user = c.get('user')
    const { plan } = c.req.valid('json')

    const now = new Date()
    const coverage = await coverageFor(plan, now, user.duesPaidThrough)
    const amountCents = priceOf(plan)

    /**
     * A payment that wouldn't move the date buys nothing.
     *
     * `coverageFor` walks forward past terms the member already holds, but gives up
     * after four hops and returns their own `paidThrough` — so the charge would go
     * through and the membership would be exactly as long as it was. It's reachable:
     * the faculty advisor and any non-student mentor are documented as wanting a
     * far-future date so the dues gate never touches them.
     *
     * Claiming has always refused this, so the two halves of this page disagreed and
     * the half that took money was the lax one.
     */
    if (
      user.duesPaidThrough !== null &&
      coverage.through <= user.duesPaidThrough
    ) {
      throw new HTTPException(409, {
        message:
          'Your membership already runs past anything this would buy, so there is nothing to pay for. Ask an officer if that looks wrong.',
      })
    }

    // Asked for here rather than at the top of the handler: a member already covered
    // gets the 409 above whether or not the club has keys. Taking the client first
    // turned that refusal into a 503 on any deployment without Stripe configured,
    // which is the supported state the previous site ran in for its whole life.
    const client = requireStripe()

    // Everything below is computed, never received. The row is written before the
    // intent so there's a record of what this server intended to charge, to compare
    // against whatever Stripe eventually reports.
    const intent = await client.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      // Lets Stripe offer whatever the account has switched on — cards, and wallets
      // on the devices that have them — without this route knowing which.
      // `allow_redirects: 'always'` admits the ones that bounce through a bank, which
      // is why the page has a return URL.
      automatic_payment_methods: { enabled: true },
      // Metadata is how a payment in the Stripe dashboard is tied back to a person
      // here. Without it, a refund request six weeks later starts with somebody
      // reading card digits down a phone.
      metadata: {
        userId: user.id,
        plan,
        termYear: String(coverage.term.year),
        termSeason: coverage.term.season,
        coversThrough: coverage.through.toISOString(),
      },
      description: `RCCF dues — ${plan === DuesPlan.YEAR ? 'academic year' : 'one semester'} (${coverage.term.season} ${coverage.term.year})`,
      /**
       * Who Stripe would email a receipt to — not the same as somebody being emailed
       * one, and the difference has bitten once.
       *
       * Stripe sends an automatic receipt only in live mode, and only with
       * "Successful payments" switched on. For a test payment it never sends; the way
       * to get one is the Dashboard's manual "Send receipt", which this pre-fills. So
       * it's worth setting and worth never promising.
       *
       * What the member is shown is `receiptUrl` — Stripe's hosted receipt, which
       * exists for every successful charge in both modes.
       */
      ...(user.email ? { receipt_email: user.email } : {}),
    })

    if (!intent.client_secret) {
      // Stripe has never done this, and if it ever does the alternative is a page that
      // renders an empty payment form with no explanation.
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
 * Claim the free window — the break, the summer, and the weeks that follow.
 *
 * Nothing is charged, and this now genuinely grants something. It used to be
 * bookkeeping: `hasAccess` was already true for the whole club through a free window,
 * so pressing the button only changed what the membership read as. Access is the date
 * now, so a member who never presses it has no access.
 *
 * That's the trade the club chose: the price of one consistent rule everywhere is
 * that being free stopped being automatic. What it buys back is a list of who is
 * actually around over a break, and a Discord Members role that means what this page
 * does.
 *
 * A button rather than a job. Flipping the whole roster at every summer and every
 * mid-year break is two mass writes a year across every user row, to learn something
 * true of a couple of dozen people.
 *
 * The window comes from this server's clock. A term the browser could name is a term
 * the browser could pick.
 */
dues.post(
  '/activate',
  originGuard,
  requireAuth,
  writes,
  async (c) => {
    const user = c.get('user')
    const standing = await claimFreeWindow(user)

    console.log(
      `dues: ${user.id} activated for the free run-up to ${standing.billable.season} ${standing.billable.year}`,
    )

    return c.json({ membership: wireMembership(user, standing) })
  },
)

// -------------------------------------------------------------------- sync

const syncSchema = z.object({
  paymentIntentId: z.string().trim().min(1).max(255),
})

/**
 * Ask Stripe how a payment turned out, and credit it if it worked.
 *
 * What the dues page calls when the member lands back on it. Not a shortcut around
 * the webhook — it asks Stripe the same question from the other direction. The
 * browser supplies only which intent to look at, and an intent belonging to somebody
 * else is refused on the row this server wrote at checkout.
 *
 * It exists because the webhook can't be relied on to have arrived: it's a separate
 * delivery over the public internet, and in development there may be no tunnel at
 * all. Without it, paying with a card that needs no further authentication leaves the
 * member looking at a page that still says they owe $25.
 */
dues.post(
  '/sync',
  originGuard,
  requireAuth,
  checks,
  validate('json', syncSchema),
  async (c) => {
    const client = requireStripe()
    const user = c.get('user')
    const { paymentIntentId } = c.req.valid('json')

    const payment = await prisma.duesPayment.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
      select: { id: true, userId: true },
    })

    // One answer for "no such payment" and "somebody else's payment", so this can't be
    // used to find out which intent ids exist.
    if (!payment || payment.userId !== user.id) {
      throw new HTTPException(404, { message: 'No such payment.' })
    }

    // Expanded, so the hosted receipt comes back in the same call rather than costing
    // a second one inside `applyPayment`.
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
    // `requires_payment_method` after an attempt means the last one was declined;
    // before any attempt it's simply a fresh intent. Both are things the member can
    // still act on, so neither is a final failure.
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
   * What else about the account this pass changed — empty for a renewal, and for every
   * re-delivery of a payment already credited.
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
 * Three rules, and what each deliberately does not do is why this is a function with
 * a test rather than three lines inside the transaction.
 *
 * Only `GUEST` is promoted. Every other role is one an officer chose, and a payment
 * must never overwrite it — least of all by quietly demoting an `OFFICER` who settled
 * their own dues. `ALUMNUS` is left alone for the same reason and costs nothing:
 * access reads the date, so an alumnus who pays is covered whatever their role says.
 *
 * `joinedAt` is stamped only alongside that promotion. This payment is the moment a
 * signup became a member. For anybody already a member a null date means the club
 * never recorded theirs, and today would print a false year on a public profile.
 *
 * No slug is ever generated. A profile page of one's own is a decision for a human,
 * and it's no longer what gets somebody's card onto `/members`.
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

  // Somebody the club marked inactive who has just paid has come back, and `active` is
  // only ever the roster's current/alumni split — there's no "barred" state to undo.
  if (!user.active) update.active = true

  return update
}

/**
 * The hosted receipt for a payment intent, or null if it can't be had.
 *
 * A `payment_intent.succeeded` webhook carries `latest_charge` as a bare id, so the
 * URL takes one more call. Best-effort on purpose: the money is the point and the
 * link is a courtesy, so a failure here must never stop a payment being credited.
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
 * One of the three functions that move that date, and they live together on purpose:
 * it's the single field that says whether anybody is covered.
 *
 * The date is `freeThrough` — the moment the window shuts, three weeks into the
 * dues-bearing term ahead. It used to be the first day of that term, back when the
 * opening weeks were free for everybody: the claim only had to carry somebody to the
 * point where the blanket trial took over. Nothing is blanket now, so claiming in
 * June would otherwise buy less than doing nothing used to.
 *
 * One window, one press. From the end of spring to three weeks into fall is a single
 * stretch, so a member claims once in May and is covered to September. Summer isn't
 * special-cased anywhere; it's free because it's inside this.
 *
 * Nothing here can move the date backwards. `canActivate` is only true when the claim
 * would genuinely extend them, but the guard in the transaction is stated rather than
 * assumed.
 *
 * It promotes exactly as paying does — same `membershipUpdateFor`, same transaction.
 * The two ways of becoming covered must leave the account in the same state, or
 * somebody who joined over the summer spends the year as a guest on their own
 * dashboard.
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

  // `canActivate` is only true when a window is running, so this is non-null. Asserted
  // rather than assumed: the alternative is writing `null` into the one column that
  // decides whether anybody is covered.
  const through = standing.freeThrough

  if (through === null) {
    throw new HTTPException(409, {
      message: 'There is nothing to activate right now — dues are owed for this term.',
    })
  }

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

    // A second press that raced the first. Theirs did the work; this one reports
    // rather than repeating it, and the date never goes backwards.
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
      `dues: ${user.id} claimed the free break and is now ${changed.role}.`,
    )
  }

  pushRoles(user.id, 'claimed the free window')

  return membershipStanding(through, now)
}

/**
 * An officer giving somebody a term, with no money involved.
 *
 * The third writer of `duesPaidThrough`, here beside the other two for the reason
 * stated on `claimFreeWindow`.
 *
 * It exists because the alternative was already happening: somebody pays a treasurer
 * in cash, an officer opens Prisma Studio and types a date into `dues_paid_through` —
 * which covers them and does nothing else. No `GUEST` promotion, no `joinedAt`, no
 * history, and no record that anybody granted anything.
 *
 * It's a payment row, for nothing, with a name on it. `amountCents: 0` says the club
 * collected nothing, `grantedById` says who decided, and the `comp_` sentinel in the
 * unique intent id keeps that column's idempotency guarantee rather than going
 * nullable. A member's history then shows the term they were given beside the terms
 * they bought.
 *
 * It extends rather than resets, because `coverageFor` is quoted against what they
 * already hold — and like both writers above it, the date can't move backwards.
 */
export async function grantMembership(
  member: { id: string; duesPaidThrough: Date | null },
  plan: DuesPlan,
  grantedById: string,
  now: Date = new Date(),
): Promise<MembershipStanding> {
  const coverage = await coverageFor(plan, now, member.duesPaidThrough)

  // The same refusal `checkout` makes: past four hops `coverageFor` gives up and hands
  // back the member's own date, so a grant beyond that would write a zero-amount row
  // recording that somebody was given nothing. Free rather than costly, but a
  // misleading record is still worth refusing.
  if (
    member.duesPaidThrough !== null &&
    coverage.through <= member.duesPaidThrough
  ) {
    throw new HTTPException(409, {
      message:
        'Their membership already runs past anything this would grant, so there is nothing to give.',
    })
  }

  const granted = await prisma.$transaction(async (tx) => {
    // Scalars only, and one query — see the note in `applyPayment` about Prisma
    // fanning relation selects across a transaction's single connection.
    const row = await tx.user.findUnique({
      where: { id: member.id },
      select: {
        duesPaidThrough: true,
        role: true,
        joinedAt: true,
        active: true,
      },
    })

    if (!row) throw new HTTPException(404, { message: 'No such member.' })

    // Unreachable in normal use — `coverageFor` hops past whatever they already hold —
    // but stated rather than assumed, the way `claimFreeWindow` states it. "The officer
    // granted me a term and my membership got shorter" isn't worth risking on a proof.
    const through =
      row.duesPaidThrough !== null && row.duesPaidThrough > coverage.through
        ? row.duesPaidThrough
        : coverage.through

    await tx.duesPayment.create({
      data: {
        userId: member.id,
        plan,
        amountCents: 0,
        status: DuesPaymentStatus.SUCCEEDED,
        // Never a real intent, and shaped so nobody mistakes it for one. Unique per
        // grant, so the constraint that stops Stripe crediting a payment twice also
        // stops two officers double-granting on one click.
        stripePaymentIntentId: `comp_${crypto.randomUUID()}`,
        termYear: coverage.term.year,
        termSeason: coverage.term.season,
        coversThrough: through,
        paidAt: now,
        grantedById,
      },
    })

    const update = membershipUpdateFor(row, now)

    await tx.user.update({
      where: { id: member.id },
      data: { duesPaidThrough: through, ...update },
    })

    return { through, update }
  })

  console.log(
    `dues: ${grantedById} granted ${member.id} a ${plan.toLowerCase()} through ${granted.through.toISOString().slice(0, 10)}${
      granted.update.role ? ` — now ${granted.update.role}` : ''
    }`,
  )

  pushRoles(member.id, `membership granted through ${granted.through.toISOString().slice(0, 10)}`)

  return membershipStanding(granted.through, now)
}

/**
 * Record what Stripe says about an intent, and extend membership if it was paid.
 *
 * The one function both the webhook and `sync` go through, and the only place
 * `duesPaidThrough` is moved forward.
 *
 * Crediting exactly once is the whole job. Stripe retries a webhook until something
 * answers 2xx, may deliver the same event twice regardless, and the member's browser
 * calls `sync` at roughly the same moment. The guard is the stored row's status: the
 * transaction only extends membership on the pass that moves it to `SUCCEEDED`, and
 * `updateMany` with that status in the `where` makes the check and the write one
 * statement two connections can't both win.
 *
 * `coversThrough` is read off the row rather than recomputed, so a member who paid in
 * August gets the dates they were quoted even if UCF has since revised the calendar.
 *
 * The rest of the account moves with the date, in the same transaction and on the same
 * pass. Doing it here rather than in the two callers keeps a member credited by the
 * webhook from ending up promoted differently to one whose browser got there first.
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
    // An intent this server never created. A live key shared with something else, or a
    // replayed event from another integration — either way there's no row saying who it
    // belongs to or what it bought, so nothing is granted.
    console.warn(`dues: payment intent ${intent.id} has no record here`)
    return { status, paidThrough: null, receiptUrl: null, changed: {} }
  }

  if (status !== DuesPaymentStatus.SUCCEEDED) {
    await prisma.duesPayment.updateMany({
      // Never walk a succeeded payment backwards. Stripe's events aren't ordered, so a
      // `payment_intent.processing` delivered late must not undo the `succeeded` that
      // already landed.
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

  // Whatever is already stored wins, then whatever the caller looked up. `applyPayment`
  // deliberately makes no call to Stripe itself: keeping the network out of the one
  // function both the webhook and `sync` funnel through is what lets the crediting
  // rules be tested against a plain object rather than a mocked SDK.
  const receiptUrl = payment.receiptUrl ?? intent.receiptUrl ?? null

  // Paid for less than the row says it was for. Stripe should never do this, but the
  // row exists precisely so it can be checked rather than assumed.
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
  ): Promise<{
    paidThrough: Date | null
    changed: MembershipUpdate
    /** Whether this pass is the one that credited it. Stripe delivers the same payment
        more than once by design, so "succeeded" isn't the same question as "something
        just changed". */
    creditedNow: boolean
  }> {
    const { count } = await tx.duesPayment.updateMany({
      where: { id: payment.id, status: { not: DuesPaymentStatus.SUCCEEDED } },
      data: {
        status: DuesPaymentStatus.SUCCEEDED,
        paidAt: new Date(),
        receiptUrl,
      },
    })

    // Scalars only, and one query. Asking for relations inside an interactive
    // transaction makes Prisma fan the selects out across the single connection it's
    // holding, which the driver adapter warns about.
    const user = await tx.user.findUnique({
      where: { id: payment.userId },
      select: {
        duesPaidThrough: true,
        role: true,
        joinedAt: true,
        active: true,
      },
    })

    // Somebody else got here first. Their pass did the crediting and the promotion;
    // this one reports the result rather than doing either again.
    if (count === 0 || !user) {
      return {
        paidThrough: user?.duesPaidThrough ?? null,
        changed: {},
        creditedNow: false,
      }
    }

    const current = user.duesPaidThrough

    // Only ever forward. Two payments landing out of order must not let the earlier one
    // shorten what the later one bought.
    const extended =
      current !== null && current > payment.coversThrough
        ? current
        : payment.coversThrough

    const changed = membershipUpdateFor(user, new Date())

    await tx.user.update({
      where: { id: payment.userId },
      data: { duesPaidThrough: extended, ...changed },
    })

    return { paidThrough: extended, changed, creditedNow: true }
  })

  const { creditedNow, ...outcome } = credited

  if (outcome.changed.role) {
    // Worth a line of its own: this is the only thing on the site that changes
    // somebody's role without an officer doing it, and the log is where anyone
    // wondering why goes to look.
    console.log(
      `dues: ${payment.userId} paid and is now ${outcome.changed.role}.`,
    )
  }

  // Only on the pass that actually credited. The webhook and the browser's confirm
  // routinely both arrive for one payment, and Stripe re-delivers besides — pushing on
  // each would ask Discord the same question three times.
  if (creditedNow) pushRoles(payment.userId, 'dues paid')

  return { status, ...outcome, receiptUrl }
}
