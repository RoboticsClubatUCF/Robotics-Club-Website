import { loadStripe, type Stripe } from '@stripe/stripe-js'

/**
 * Stripe.js, loaded once for the whole app.
 *
 * At module scope on purpose: `loadStripe` injects a script tag, so calling it from a component
 * would add one per render. It lives here rather than beside the payment form because that is a
 * side effect on import, and a file that does something when it is imported should look like one.
 *
 * The publishable key is not a secret — it is designed to be read by anyone looking at the page,
 * and it can only create payments, never see or move money. The secret key never leaves the server.
 * It is still configuration rather than a literal, so it comes from the environment and is baked in
 * at build time like every other `VITE_` value.
 *
 * Unset, this is null and the dues page says card payments are not switched on, rather than
 * rendering a form that can never submit. The server has its own half of that switch —
 * `paymentsEnabled` on `GET /api/dues/status` — and the page names which of the two is missing,
 * because they are fixed in different places.
 */

const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as
  | string
  | undefined

export const stripePromise: Promise<Stripe | null> | null = publishableKey
  ? loadStripe(publishableKey)
  : null

export const stripeKeyConfigured = stripePromise !== null
