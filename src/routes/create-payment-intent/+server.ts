import Stripe from 'stripe';
import { SECRET_STRIPE_KEY } from '$env/static/private';
import config from '../../config.ts';
import { duesType } from '../../stores';
import { get } from 'svelte/store';

// initialize Stripe
const stripe = new Stripe(SECRET_STRIPE_KEY);
// handle POST /create-payment-intent
export async function POST() {
  // create the payment intent
  const paymentIntent = await stripe.paymentIntents.create({
    amount: Number(config.paypal.semester_cost) * 100,
    // note, for some EU-only payment methods it must be EUR
    currency: 'USD',
    // specify what payment methods are allowed
    // can be card, sepa_debit, ideal, etc...
    payment_method_types: ['card']
  });

  // return the clientSecret to the client
  return new Response(JSON.stringify({ clientSecret: paymentIntent.client_secret }));
}

// "variable" is the variable configured in the stores.ts
// function figureOutDues() {
//   const ds = get(duesType);
//   console.log(ds);
//   if (ds == '1') {
//     return Number(config.paypal.year_cost);
//   } else {
//     return Number(config.paypal.semester_cost);
//   }
// }
