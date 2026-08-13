import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js'
import { useState, type FormEvent } from 'react'
import { submitClass } from '../shared/formChrome'
import { formatMoney } from '../../lib/dues'
import { stripePromise } from '../../lib/stripe'
import { stripeAppearance } from './stripeAppearance'

/**
 * The card form, and the confirm that follows it.
 *
 * `PaymentElement` rather than a hand-built card field: it renders whatever the
 * club's Stripe account has switched on — cards, and the wallets a given device
 * offers — and none of the card details ever touch this origin, which is what
 * keeps the club out of the part of PCI compliance that has paperwork in it.
 *
 * The one thing worth understanding here is that **this component never decides
 * that a payment succeeded.** `confirmPayment` reports what the browser saw,
 * and the browser is not a source of truth about money: it hands the intent id
 * up to the page, which asks the server, which asks Stripe. See
 * `POST /api/dues/sync`.
 */
export function PaymentForm({
  clientSecret,
  amountCents,
  onPaid,
  onCancel,
}: {
  clientSecret: string
  amountCents: number
  /** The intent id, for the page to have the server confirm. Never a success flag. */
  onPaid: (paymentIntentId: string) => void
  onCancel: () => void
}) {
  if (!stripePromise) return null

  return (
    <Elements
      stripe={stripePromise}
      /* `clientSecret` is part of the key as well as the options: Elements
         binds to one payment intent for its lifetime, so a member who changes
         plan and gets a new intent needs a new tree rather than a re-render
         Stripe would ignore. */
      key={clientSecret}
      options={{ clientSecret, appearance: stripeAppearance }}
    >
      <ConfirmForm
        amountCents={amountCents}
        onPaid={onPaid}
        onCancel={onCancel}
      />
    </Elements>
  )
}

type ConfirmState =
  | { status: 'idle' }
  | { status: 'confirming' }
  | { status: 'failed'; message: string }

function ConfirmForm({
  amountCents,
  onPaid,
  onCancel,
}: {
  amountCents: number
  onPaid: (paymentIntentId: string) => void
  onCancel: () => void
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [state, setState] = useState<ConfirmState>({ status: 'idle' })
  // Stripe's own form takes a moment to arrive over the network, and a pay
  // button that is live before the fields exist is a button that does nothing.
  const [ready, setReady] = useState(false)

  const pay = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!stripe || !elements || state.status === 'confirming') return

    setState({ status: 'confirming' })

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        // Only used by the payment methods that leave the site — a bank's
        // 3-D Secure page, some wallets. The dues page reads the intent out of
        // the query string when it is landed back on.
        return_url: `${window.location.origin}/dashboard/dues`,
      },
      // Keeps everything that can finish here on the page. Without it Stripe
      // redirects even for a plain card, and the member watches the whole site
      // reload to be told something they could have been told in place.
      redirect: 'if_required',
    })

    if (error) {
      setState({
        status: 'failed',
        // Stripe writes these for the cardholder — "your card was declined",
        // "your card has insufficient funds" — and they are better than
        // anything this file could say. The fallback is for the error types
        // that carry no customer-facing message, which are bugs here rather
        // than problems with the card.
        message:
          error.message ??
          'That payment could not be completed. Please check the details and try again.',
      })
      return
    }

    if (paymentIntent) {
      // Deliberately not treated as "paid" — only as "worth asking about".
      onPaid(paymentIntent.id)
    }
  }

  return (
    <form
      /* Wrapped rather than passed directly: `pay` is async, and handing a
         promise-returning function to an event attribute leaves a rejection
         with nowhere to go. Everything it can fail at is already handled
         inside it, so the promise is deliberately dropped here. */
      onSubmit={(event) => {
        void pay(event)
      }}
      className="flex flex-col gap-5"
    >
      <PaymentElement
        onReady={() => {
          setReady(true)
        }}
      />

      <button
        type="submit"
        disabled={!stripe || !ready || state.status === 'confirming'}
        className={submitClass}
      >
        {state.status === 'confirming'
          ? 'PAYING…'
          : `PAY ${formatMoney(amountCents)}`}
      </button>

      <button
        type="button"
        onClick={onCancel}
        disabled={state.status === 'confirming'}
        className="text-faint hover:text-primary cursor-pointer font-mono text-[11px] font-medium tracking-[0.14em] transition-colors duration-200 disabled:cursor-not-allowed"
      >
        CHOOSE A DIFFERENT PLAN
      </button>

      <p role="status" className="text-error text-sm leading-[1.6] text-pretty">
        {state.status === 'failed' && state.message}
      </p>
    </form>
  )
}
