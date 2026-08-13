import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useOutletContext, useSearchParams } from 'react-router'
import { MembershipPanel } from '../components/dues/MembershipPanel'
import { PaymentForm } from '../components/dues/PaymentForm'
import { PlanPicker } from '../components/dues/PlanPicker'
import {
  FormEyebrow,
  FormHeading,
  FormPanel,
  secondaryClass,
  submitClass,
} from '../components/shared/formChrome'
import {
  ApiError,
  getJson,
  postJson,
  type ApiCheckout,
  type ApiDuesPlan,
  type ApiDuesStatus,
  type ApiDuesSync,
  type DuesPlan,
} from '../lib/api'
import type { DashboardContext } from '../components/dashboard/DashboardLayout'
import { useSession } from '../lib/session'
import { formatDate, formatMoney, termLabel, termsLabel } from '../lib/dues'
import { stripeKeyConfigured } from '../lib/stripe'
import { socialLinks } from '../content/home'

/**
 * Paying dues.
 *
 * Three things it has to get right, in the order they bite:
 *
 * **The offer to pay is always there.** Somebody on the free trial, or reading
 * this in the middle of a free summer, can pay for the term ahead right now
 * rather than being told to come back later — which is the whole reason the
 * plans render above the fold in every state rather than only when money is
 * owed.
 *
 * **The browser never decides a payment worked.** Stripe's confirm hands back
 * an intent id and nothing more is inferred from it; the page posts it to
 * `/api/dues/sync`, which asks Stripe, and the membership shown afterwards is
 * whatever came back from the server.
 *
 * **It survives being landed on.** A payment method that bounces through a bank
 * returns the member to this URL with `?payment_intent=…` on it, in a fresh
 * page load with none of the state that was here before. That query string is
 * treated as the only thing that has to be believed.
 *
 * It lives at `/dashboard/dues` and renders no page column of its own —
 * `DashboardLayout` supplies the rail, the gutter and the width, the same as
 * every other page in the section. It keeps its own session handling anyway:
 * the layout gate runs first in the app, but this page is also rendered on its
 * own in tests, and a component that falls over without a parent is a component
 * that can only be tested through one.
 */

type PageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: ApiDuesStatus }

type Checkout =
  | { status: 'none' }
  | { status: 'starting' }
  | { status: 'failed'; message: string }
  | { status: 'open'; intent: ApiCheckout }
  /** Stripe accepted it; the server has not confirmed it yet. */
  | { status: 'confirming' }
  | { status: 'paid'; paidThrough: string | null; receiptUrl: string | null }

/** Claiming the free window. Its own state, since it is not a purchase. */
type Activation =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'failed'; message: string }

export function DuesPage() {
  const { session, refresh } = useSession()
  /**
   * Nullable on purpose. Inside the app this page is always under
   * `DashboardLayout` and the context is there; its own tests render it alone,
   * and a page that falls over without a parent can only ever be tested through
   * one. The rail unlocking is a courtesy either way — the server is what
   * decides who may run things.
   */
  const dashboard = useOutletContext<DashboardContext | null>()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const [page, setPage] = useState<PageState>({ status: 'loading' })
  const [plan, setPlan] = useState<DuesPlan | null>(null)
  const [checkout, setCheckout] = useState<Checkout>({ status: 'none' })
  const [activation, setActivation] = useState<Activation>({ status: 'idle' })
  /** Which returned intent has already been sent to the server. See the effect below. */
  const handledIntent = useRef<string | null>(null)

  const returnedIntent = params.get('payment_intent')

  // Nobody signed in has nothing to pay for, and the login page sends them
  // straight back here afterwards rather than to the dashboard.
  useEffect(() => {
    if (session.status === 'signed-out') {
      void navigate('/login', {
        replace: true,
        state: { from: '/dashboard/dues' },
      })
    }
  }, [session.status, navigate])

  const load = useCallback(async () => {
    try {
      const data = await getJson<ApiDuesStatus>('/dues/status')
      setPage({ status: 'ready', data })
      // Default to the semester, which is the smaller commitment and the one
      // most people want. Only set once, so a reload after a failed payment
      // does not undo a choice.
      setPlan((current) => current ?? 'SEMESTER')
    } catch (error) {
      console.error(error)
      setPage({
        status: 'error',
        message:
          error instanceof ApiError && error.status === 0
            ? "Couldn't reach the server. Check your connection and try again."
            : 'We could not load your membership just now. Please try again.',
      })
    }
  }, [])

  useEffect(() => {
    if (session.status === 'signed-in') void load()
  }, [session.status, load])

  /**
   * Ask the server what became of an intent, and take its answer as the truth.
   *
   * Used by both routes into this page: the confirm that finished in place, and
   * the redirect back from a bank. Neither is trusted to mean "paid" on its own.
   */
  const confirmWithServer = useCallback(
    async (paymentIntentId: string) => {
      setCheckout({ status: 'confirming' })

      try {
        const result = await postJson<ApiDuesSync>('/dues/sync', {
          paymentIntentId,
        })

        if (result.status === 'SUCCEEDED') {
          setCheckout({
            status: 'paid',
            paidThrough: result.paidThrough,
            receiptUrl: result.receiptUrl,
          })

          // The date is not the only thing that moved: a first payment takes
          // the account off GUEST and onto the roster ladder. The session
          // context is the one copy of that the nav and the dashboard sidebar
          // read, and it was fetched before any of this happened — so it has to
          // be asked again rather than left saying what it said on arrival.
          await refresh()
          // And the rail is holding a standing from before the payment, which
          // is what greys out a lapsed lead's management links.
          await dashboard?.reloadMembership()
        } else if (result.status === 'PENDING') {
          // Real, and not finished: some methods take minutes to clear. Saying
          // "it worked" here would be a guess, and saying "it failed" would be
          // wrong.
          setCheckout({
            status: 'failed',
            message:
              'Your payment is still going through. It usually takes a moment — reload this page shortly and it should show as paid.',
          })
        } else {
          setCheckout({
            status: 'failed',
            message:
              'That payment did not go through. Nothing has been charged — you can try again.',
          })
        }
      } catch (error) {
        console.error(error)
        setCheckout({
          status: 'failed',
          message:
            'We could not confirm that payment. If you were charged, it will still be applied — reload this page in a minute, or ask an officer.',
        })
      }

      // Either way the membership panel is out of date now.
      await load()
    },
    [load, refresh, dashboard],
  )

  /**
   * Landed back here from a bank's page, with the intent on the query string.
   *
   * Guarded by a ref rather than by leaving things out of the dependency list.
   * The effect clears the query string it just read, which re-runs it, and
   * under StrictMode it is double-invoked besides — so it has to be safe to
   * enter twice for the same id rather than merely unlikely to be. The ref is
   * what makes "confirm this once" true instead of hopeful.
   *
   * The parameters come off the URL either way, so a reload or a link somebody
   * pasted to a friend does not start a confirmation over.
   */
  useEffect(() => {
    if (!returnedIntent || session.status !== 'signed-in') return
    if (handledIntent.current === returnedIntent) return
    handledIntent.current = returnedIntent

    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.delete('payment_intent')
        next.delete('payment_intent_client_secret')
        next.delete('redirect_status')
        return next
      },
      { replace: true },
    )

    void confirmWithServer(returnedIntent)
  }, [returnedIntent, session.status, confirmWithServer, setParams])

  /**
   * Claim the free window. One row, one press, and the server decides which
   * window it was — see `POST /api/dues/activate`.
   */
  const activate = async () => {
    setActivation({ status: 'saving' })

    try {
      await postJson('/dues/activate', {})
      // Re-read rather than patching the membership out of the response: the
      // page has one source of truth for its own state and this is it.
      await load()
      // Claiming promotes a guest to member, so the nav and the rail are both
      // holding an answer from before the press.
      await refresh()
      await dashboard?.reloadMembership()
      setActivation({ status: 'idle' })
    } catch (error) {
      console.error(error)
      setActivation({
        status: 'failed',
        message:
          error instanceof ApiError && error.detail
            ? error.detail
            : 'We could not switch that on just now. Try again in a moment.',
      })
    }
  }

  const startCheckout = async () => {
    if (!plan) return
    setCheckout({ status: 'starting' })

    try {
      const intent = await postJson<ApiCheckout>('/dues/checkout', { plan })
      setCheckout({ status: 'open', intent })
    } catch (error) {
      console.error(error)
      setCheckout({
        status: 'failed',
        message:
          error instanceof ApiError && error.detail
            ? error.detail
            : 'We could not start that payment. Please try again.',
      })
    }
  }

  /**
   * Ahead of the loading and error gates on purpose.
   *
   * The server has confirmed this payment with Stripe. Everything that happens
   * afterwards — re-reading the membership panel, re-reading the session — is
   * housekeeping, and a housekeeping request that fails must not be able to
   * replace "you're all set" with "we can't reach the server" for somebody who
   * has just been charged.
   */
  if (checkout.status === 'paid') {
    return (
      <Paid
        paidThrough={checkout.paidThrough}
        receiptUrl={checkout.receiptUrl}
      />
    )
  }

  if (session.status === 'loading' || page.status === 'loading') {
    return (
      <>
        <div aria-busy="true">
          <FormEyebrow>/ DUES</FormEyebrow>
          <FormHeading>Loading your membership…</FormHeading>
          <div className="border-rule bg-base-200 h-40 border" />
        </div>
      </>
    )
  }

  if (session.status === 'error' || page.status === 'error') {
    return (
      <>
        <FormEyebrow>/ DUES</FormEyebrow>
        <FormHeading>We can't reach the server.</FormHeading>
        <FormPanel tone="accent">
          <p className="text-dim text-sm leading-[1.7] text-pretty">
            {page.status === 'error'
              ? page.message
              : "Couldn't reach the server to check who you are."}
          </p>
        </FormPanel>
      </>
    )
  }

  // The redirect in the effect above is on its way.
  if (session.status !== 'signed-in') return null

  const { membership, plans, paymentsEnabled, history } = page.data
  const selectedPlan = plans.find((option) => option.plan === plan) ?? null
  const canPay = paymentsEnabled && stripeKeyConfigured

  return (
    <>
      <FormEyebrow>/ DUES</FormEyebrow>
      <FormHeading>
        {membership.status === 'EXPIRED'
          ? 'Time to renew.'
          : 'Your membership.'}
      </FormHeading>

      <div className="mb-8">
        <MembershipPanel membership={membership} />
      </div>

      {membership.canActivate && (
        <div className="mb-8">
          <FreeWindow
            membership={membership}
            state={activation}
            onActivate={() => void activate()}
          />
        </div>
      )}

      {!canPay ? (
        <PaymentsOff configuredOnServer={paymentsEnabled} />
      ) : checkout.status === 'confirming' ? (
        <FormPanel tone="accent">
          <p className="mb-1.5 text-sm font-semibold">Checking with Stripe…</p>
          <p className="text-dim text-sm leading-[1.7] text-pretty">
            Don't close this tab. We are confirming the payment with Stripe
            rather than taking the browser's word for it.
          </p>
        </FormPanel>
      ) : checkout.status === 'open' ? (
        <>
          <p className="text-faint mb-4 font-mono text-[10px] font-medium tracking-[0.16em]">
            PAYING {formatMoney(checkout.intent.amountCents)} FOR{' '}
            {termsLabel(checkout.intent.covers).toUpperCase()}
          </p>
          <PaymentForm
            clientSecret={checkout.intent.clientSecret}
            amountCents={checkout.intent.amountCents}
            onPaid={(id) => void confirmWithServer(id)}
            onCancel={() => {
              setCheckout({ status: 'none' })
            }}
          />
        </>
      ) : (
        <>
          {/* Offered in every state, including the two where nothing is owed.
              Somebody on a trial or in the middle of a free summer can settle
              the term ahead now instead of being told to come back — which is
              the single most useful thing this page does for the club. */}
          <p className="text-faint mb-4 font-mono text-[10px] font-medium tracking-[0.16em]">
            {membership.duesRequired
              ? 'PAY YOUR DUES'
              : membership.status === 'ACTIVE'
                ? 'PAY AHEAD FOR THE NEXT TERM'
                : 'PAY NOW AND HAVE IT DONE WITH'}
          </p>

          <PayingAhead membership={membership} plans={plans} />

          <PlanPicker
            plans={plans}
            selected={plan}
            onSelect={setPlan}
            disabled={checkout.status === 'starting'}
          />

          <button
            type="button"
            onClick={() => void startCheckout()}
            disabled={!selectedPlan || checkout.status === 'starting'}
            className={`${submitClass} mt-6`}
          >
            {checkout.status === 'starting'
              ? 'STARTING…'
              : selectedPlan
                ? `CONTINUE — ${formatMoney(selectedPlan.amountCents)}`
                : 'CONTINUE'}
          </button>

          <p
            role="status"
            className="text-error mt-4 text-sm leading-[1.6] text-pretty"
          >
            {checkout.status === 'failed' && checkout.message}
          </p>
        </>
      )}

      {history.length > 0 && (
        <div className="mt-10">
          <p className="text-faint mb-4 font-mono text-[10px] font-medium tracking-[0.16em]">
            WHAT YOU HAVE PAID
          </p>
          <ul className="border-rule divide-rule divide-y border">
            {history.map((payment) => (
              <li
                key={payment.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3"
              >
                <span className="text-sm">
                  {formatMoney(payment.amountCents)}{' '}
                  <span className="text-dim">
                    — {payment.plan === 'YEAR' ? 'academic year' : 'semester'},
                    through {formatDate(payment.coversThrough)}
                  </span>
                </span>
                <span className="text-faint flex items-center gap-3 font-mono text-[11px]">
                  {payment.paidAt ? formatDate(payment.paidAt) : '—'}
                  {/* The only receipt most members will ever get — Stripe's
                      automatic email is live-mode-only and off by default. */}
                  {payment.receiptUrl && (
                    <a
                      href={payment.receiptUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="hover:text-primary underline underline-offset-2 transition-colors duration-200"
                    >
                      RECEIPT
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

/**
 * The summer, and the gap between one term and the next.
 *
 * Both are free, and both used to be free *silently* — the calendar covered
 * everybody, including every account that has not been near the club since
 * 2023. Claiming makes "active member over the summer" something a person did.
 * The alternative is the club flipping the whole roster twice a year, which is
 * a mass write about hundreds of people to learn something true of a couple of
 * dozen.
 *
 * So this has to be clear that pressing it costs nothing and is not a payment.
 * A gold panel above a page of prices is going to be read as a bill by
 * somebody, which is why the first line says what it does not do.
 */
function FreeWindow({
  membership,
  state,
  onActivate,
}: {
  membership: ApiDuesStatus['membership']
  state: Activation
  onActivate: () => void
}) {
  const summer = membership.term.season === 'SUMMER'

  return (
    <FormPanel tone="accent">
      <p className="text-faint mb-3 font-mono text-[10px] font-medium tracking-[0.16em]">
        {summer ? 'SUMMER MEMBERSHIP' : 'BETWEEN SEMESTERS'}
      </p>
      <p className="mb-1.5 text-sm font-semibold">
        {summer
          ? 'Summer is free — switch it on.'
          : 'The break is free — switch it on.'}
      </p>
      <p className="text-dim text-sm leading-[1.7] text-pretty">
        No charge and no card. It marks you as an active member{' '}
        {membership.freeThrough ? (
          <>
            through{' '}
            <strong className="text-white">
              {formatDate(membership.freeThrough)}
            </strong>
          </>
        ) : (
          <>until {termLabel(membership.billable)} dues begin</>
        )}
        , so the club knows who is around — you keep the lab and your projects
        either way.
      </p>

      <button
        type="button"
        disabled={state.status === 'saving'}
        onClick={onActivate}
        className="btn btn-primary btn-cta mt-5 px-7 py-[15px] text-[13px] font-semibold disabled:opacity-60"
      >
        {state.status === 'saving'
          ? 'SWITCHING ON…'
          : 'ACTIVATE MY MEMBERSHIP'}
      </button>

      <p role="status" className="text-error mt-3 min-h-4 text-[13px] leading-[1.5]">
        {state.status === 'failed' && state.message}
      </p>
    </FormPanel>
  )
}

/**
 * The sentence a paid-up member needs before they buy anything.
 *
 * The server has always got this right — `coverageFor` walks past whatever
 * `duesPaidThrough` already covers, so the plans quoted to somebody paid
 * through May start at the *following* fall — but nothing on the page said so.
 * The reading it invites is that the club is charging twice for the semester
 * you are sitting in, and the member who believes that either doesn't pay or
 * pays and then asks an officer where their money went.
 *
 * Only for somebody `ACTIVE` **on a payment**. On a trial or in an unclaimed
 * free window the plans do cover the term ahead of you, which is what the
 * eyebrow beside this already says, and a second sentence would be noise.
 *
 * `freeActive` is excluded and that exclusion is the whole reason this comment
 * is long. `ACTIVE` used to mean exactly "paid through a date in the future",
 * and this read `paidThrough` on the strength of it. Claiming a free window
 * broke that: it makes somebody `ACTIVE` while their *old* `paidThrough` sits
 * in the past, so a member who lapsed in December and claimed the summer was
 * told "you are already paid through December 10, 2025" — a lapsed date read
 * back to them as current cover. What that state needs is already in
 * `MembershipPanel`, which says the membership is active, that it is free, and
 * when dues for the term ahead begin.
 *
 * Both plans start from the same term — the semester buys it, the year buys it
 * and the one after — so the first one named on either is the term this is
 * about.
 */
function PayingAhead({
  membership,
  plans,
}: {
  membership: ApiDuesStatus['membership']
  plans: ApiDuesPlan[]
}) {
  const startsAt = plans[0]?.covers[0]

  // Once `freeActive` is out, `paidThrough` really is in the future — that is
  // what `ACTIVE` on a payment means — so the null check is for the type.
  if (
    membership.status !== 'ACTIVE' ||
    membership.freeActive ||
    !membership.paidThrough ||
    !startsAt
  ) {
    return null
  }

  return (
    <p className="text-dim mb-4 text-sm leading-[1.7] text-pretty">
      You are already paid through{' '}
      <strong className="text-white">
        {formatDate(membership.paidThrough)}
      </strong>
      , so nothing here pays for the semester you are in. Both plans start from{' '}
      <strong className="text-white">{termLabel(startsAt)}</strong> and add to
      what you have rather than replacing it.
    </p>
  )
}

/**
 * The state where the club has no Stripe account yet, or the build shipped
 * without a publishable key.
 *
 * Said plainly rather than shown as a broken button. Dues were collected in
 * person for the whole life of the previous site, and that still works — what
 * would not work is a member trying to pay here three times and giving up.
 */
function PaymentsOff({ configuredOnServer }: { configuredOnServer: boolean }) {
  const discord = socialLinks.find((link) => link.label === 'DISCORD')?.href

  return (
    <FormPanel tone="accent">
      <p className="mb-1.5 text-sm font-semibold">
        Card payments aren't switched on yet.
      </p>
      <p className="text-dim text-sm leading-[1.7] text-pretty">
        You can still pay your dues — ask an officer at a general body meeting
        or in the Discord, and they will take it and mark your account. Nothing
        about your membership is affected by this page.
      </p>
      {/* Two different problems with the same symptom, and only one of them is
          the club's to fix. Naming which keeps whoever deploys this from
          checking the wrong end. */}
      {!configuredOnServer ? null : (
        <p className="text-faint mt-3 text-[13px] leading-[1.5] text-pretty">
          (The server can take payments — this build of the site is missing
          <code className="mx-1 font-mono">VITE_STRIPE_PUBLISHABLE_KEY</code>.)
        </p>
      )}
      {discord && (
        <a
          href={discord}
          target="_blank"
          rel="noreferrer noopener"
          className="btn btn-primary btn-cta mt-5 px-7 py-[15px] text-[13px] font-semibold"
        >
          OPEN THE DISCORD
        </a>
      )}
    </FormPanel>
  )
}

/**
 * This screen used to say Stripe had emailed a receipt. It hadn't.
 *
 * Stripe sends an automatic receipt only in live mode, and only when the
 * account has "Successful payments" switched on under Settings → Business →
 * Customer emails — never for a test payment. So the sentence was false every
 * time it was read in development and merely *probably* true in production,
 * which is exactly the kind of claim the rest of this site refuses to make.
 *
 * What Stripe does create for every successful charge is a hosted receipt page,
 * and linking to that is true in both modes. The link is Stripe's own and
 * expires after 30 days, at which point it offers to mail a fresh one — so the
 * wording promises a receipt, not an archive.
 */
function Paid({
  paidThrough,
  receiptUrl,
}: {
  paidThrough: string | null
  receiptUrl: string | null
}) {
  return (
    <>
      <FormEyebrow>/ PAID</FormEyebrow>
      <FormHeading>You're all set.</FormHeading>

      <p className="text-dim mb-7 text-sm leading-[1.7] text-pretty">
        {paidThrough
          ? `Your dues are paid through ${formatDate(paidThrough)}.`
          : 'Your payment went through.'}{' '}
        {receiptUrl ? (
          <>
            Your receipt is{' '}
            <a
              href={receiptUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary underline underline-offset-2"
            >
              here
            </a>
            {' '}— it is also on your dues page whenever you need it.
          </>
        ) : (
          'You can see this payment on your dues page at any time.'
        )}
      </p>

      <div className="flex flex-wrap items-center gap-3.5">
        <Link
          to="/dashboard"
          className="btn btn-primary btn-cta px-7 py-[15px] text-[13px] font-semibold"
        >
          GO TO MY DASHBOARD
        </Link>
        <Link to="/" className={secondaryClass}>
          Back to the front page
        </Link>
      </div>
    </>
  )
}
