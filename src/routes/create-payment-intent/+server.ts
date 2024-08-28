import Stripe from 'stripe';
import { SECRET_STRIPE_KEY } from '$env/static/private';
import config from '../../config';

// initialize Stripe
const stripe = new Stripe(SECRET_STRIPE_KEY);

export async function POST({ request }) {
  const { duesType } = await request.json();

  const amount = duesType === '1' ? config.paypal.semester_cost : config.paypal.year_cost;
  console.log(amount);

  const paymentIntent = await stripe.paymentIntents.create({
    amount: Number(amount) * 100, // Stripe amounts are in cents
    currency: 'USD',
    payment_method_types: ['card']
  });

  return new Response(JSON.stringify({ clientSecret: paymentIntent.client_secret }));
}
