import Stripe from 'stripe'
import { env } from '../core/env.js'

/**
 * The Stripe client, configured the same way Postmark and Discord are: as a set
 * that may be entirely absent.
 *
 * The club has to be able to run this site before somebody with access to the
 * Stripe account has made keys, and before that account exists at all. Unset,
 * dues cannot be paid *here* — the page says so and points at an officer, which
 * is how dues were collected for the whole life of the previous site — rather
 * than the API refusing to start or the dues page erroring.
 *
 * `stripeConfigured` is logged at startup for the same reason `mailConfigured`
 * and `discordConfigured` are: a payment page that quietly cannot take payments
 * looks exactly like one that can.
 */

export const stripe = env.STRIPE_SECRET_KEY
  ? new Stripe(env.STRIPE_SECRET_KEY, {
      // Written out rather than left implicit. The SDK pins this version
      // itself, so the value is not a choice — but it *is* the version every
      // object below is shaped by, and an upgrade that silently changes it is
      // exactly the kind of thing to find out about from a webhook handler in
      // production. Bumping the package and this line together is the point.
      apiVersion: '2026-07-29.dahlia',
      // Card networks are unreliable in a way that is usually worth one more
      // attempt; the SDK only retries what is safe to retry.
      maxNetworkRetries: 2,
      appInfo: {
        name: 'RCCF Website',
        version: '13.0.0',
        url: 'https://github.com/RoboticsClubatUCF',
      },
    })
  : null

export const stripeConfigured = stripe !== null

/** Whether webhook deliveries can be checked, which decides whether any are accepted. */
export const webhooksConfigured = Boolean(
  env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET,
)
