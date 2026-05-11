import Stripe from 'stripe';
import { SECRET_STRIPE_KEY } from '$env/static/private';
import config from '../../config';
import { error } from '@sveltejs/kit';

const stripe = new Stripe(SECRET_STRIPE_KEY);

export async function POST({ request, locals }) {
  if (!locals.member) throw error(401, 'Unauthorized');

  const { duesType } = await request.json();

  const amount = duesType === '1' ? config.paypal.semester_cost : config.paypal.year_cost;

  const paymentIntent = await stripe.paymentIntents.create({
    amount: Number(amount) * 100, // Stripe amounts are in cents
    currency: 'USD',
    payment_method_types: ['card']
  });

  return new Response(JSON.stringify({ clientSecret: paymentIntent.client_secret }));
}
