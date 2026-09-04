import { Hono } from 'hono'
import type Stripe from 'stripe'
import { prisma } from '../../core/db.js'
import { env } from '../../core/env.js'
import { DuesPaymentStatus } from '../../generated/prisma/enums.js'
import { stripe } from '../../payments/stripe.js'
import { applyPayment, receiptUrlFor } from '../member/dues.js'

/**
 * Stripe telling us what happened, unprompted.
 *
 *   POST /api/stripe/webhook
 *
 * The half of the payment flow that does not depend on the member still having the tab open.
 * `POST /api/dues/sync` covers the common case — a card that clears in two seconds while somebody
 * watches — but a bank that takes a minute over 3-D Secure, or a member who closes the laptop the
 * moment the button is pressed, is only ever credited by this.
 *
 * Three things about it are not like the other routes.
 *
 * The body must stay raw. The signature is computed over the exact bytes Stripe sent, so anything
 * that parses and re-serialises the JSON first — reordering a key, changing an escape —
 * invalidates it. Hence `c.req.text()` and no `zValidator`.
 *
 * It is unauthenticated, and the signature is the only thing standing in for that. Without
 * `STRIPE_WEBHOOK_SECRET` there is nothing to check a delivery against, so every delivery is
 * refused: an endpoint that grants membership on an unverified POST is a form anybody on the
 * internet can fill in.
 *
 * A 2xx means "recorded", not "agreed". Stripe retries anything else for days, so a delivery this
 * cannot use — an unhandled event type, an intent from some other integration — is answered 200 and
 * dropped. Only a genuine failure to write is worth a retry.
 */
export const stripeWebhook = new Hono()

stripeWebhook.post('/webhook', async (c) => {
  const secret = env.STRIPE_WEBHOOK_SECRET

  if (!stripe || !secret) {
    console.error(
      'stripe webhook: refused a delivery — STRIPE_WEBHOOK_SECRET is not configured',
    )
    return c.json({ error: 'Webhooks are not configured.' }, 503)
  }

  const signature = c.req.header('stripe-signature')

  if (!signature) {
    return c.json({ error: 'Missing signature.' }, 400)
  }

  const body = await c.req.text()
  let event: Stripe.Event

  try {
    // The async form, because it uses WebCrypto rather than the Node-only
    // implementation. The verification also carries a timestamp tolerance, so a
    // delivery someone captured and replays tomorrow is rejected on its age.
    event = await stripe.webhooks.constructEventAsync(body, signature, secret)
  } catch (error) {
    // A bad signature is either a misconfigured secret or somebody trying it
    // on, and there is no way to tell from here. 400 rather than 401, because
    // that is what Stripe's own dashboard shows as a delivery failure.
    console.error('stripe webhook: signature did not verify', error)
    return c.json({ error: 'Signature verification failed.' }, 400)
  }

  try {
    await handle(event)
  } catch (error) {
    // The one case worth a retry: the event was genuine and something here
    // failed to record it. Stripe will send it again.
    console.error(`stripe webhook: ${event.type} ${event.id} failed`, error)
    return c.json({ error: 'Could not record that event.' }, 500)
  }

  return c.json({ received: true })
})

async function handle(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'payment_intent.succeeded':
    case 'payment_intent.payment_failed':
    case 'payment_intent.canceled':
    case 'payment_intent.processing': {
      const intent = event.data.object

      // A webhook payload carries `latest_charge` as a bare id, so the hosted receipt costs one
      // more call — and only when there is a charge to have one, which is why the other three event
      // types skip it. `receiptUrlFor` swallows its own failures: the money is the point and the
      // link is a courtesy.
      const receiptUrl =
        intent.status === 'succeeded' ? await receiptUrlFor(intent.id) : null

      const result = await applyPayment({
        id: intent.id,
        status: intent.status,
        // `amount_received` rather than `amount`: the first is what actually
        // arrived, the second what was asked for.
        amount: intent.amount_received || intent.amount,
        receiptUrl,
      })

      console.log(
        `stripe webhook: ${intent.id} -> ${result.status}${
          result.paidThrough
            ? `, dues paid through ${result.paidThrough.toDateString()}`
            : ''
        }`,
      )
      return
    }

    case 'charge.refunded': {
      const charge = event.data.object
      const intentId =
        typeof charge.payment_intent === 'string'
          ? charge.payment_intent
          : charge.payment_intent?.id

      if (!intentId) return

      const { count } = await prisma.duesPayment.updateMany({
        where: { stripePaymentIntentId: intentId },
        data: { status: DuesPaymentStatus.REFUNDED },
      })

      if (count === 0) return

      // Deliberately does not shorten anybody's membership. A refund can be partial, can be a
      // duplicate charge being tidied up, and can be a chargeback the club intends to contest —
      // none of which mean the member should lose access this minute, and getting it wrong locks
      // somebody out of the lab with no way to argue. It is loud instead, and an officer decides in
      // Prisma Studio.
      console.warn(
        `stripe webhook: ${intentId} was refunded. Membership was NOT shortened automatically — adjust users.dues_paid_through by hand if it should be.`,
      )
      return
    }

    default:
      // Everything Stripe sends that this site has no opinion about. Answered
      // 200 by the caller so it is not retried for three days.
      return
  }
}
