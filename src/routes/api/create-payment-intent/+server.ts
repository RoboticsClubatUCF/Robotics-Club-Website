import Stripe from 'stripe';
import { env } from '$env/dynamic/private';
import { error, json } from '@sveltejs/kit';
import { assertSameOrigin } from '$lib/server/security';
import type { RequestHandler } from './$types';
import { DUES } from '$lib/constants';
import { z } from 'zod';

const bodySchema = z.object({
	duesType: z.enum(['semester', 'year', '1', '2']).default('year')
});

export const POST: RequestHandler = async ({ request, locals, url }) => {
	assertSameOrigin(request, url);
	if (!locals.user) throw error(401, 'Unauthorized');

	const rawBody = await request.json().catch(() => ({}));
	const parsed = bodySchema.safeParse(rawBody);

	if (!parsed.success) {
		throw error(400, { message: 'Invalid dues type: ' + parsed.error.issues[0].message });
	}

	if (!env.SECRET_STRIPE_KEY) {
		console.error('[Stripe] SECRET_STRIPE_KEY is missing');
		throw error(500, 'Payment service is not configured');
	}

	const { duesType } = parsed.data;
	const amount = ['semester', '1'].includes(duesType) ? DUES.semester : DUES.year;

	const stripe = new Stripe(env.SECRET_STRIPE_KEY);

	try {
		const paymentIntent = await stripe.paymentIntents.create({
			amount: amount * 100,
			currency: 'usd',
			payment_method_types: ['card'],
			metadata: {
				userId: String(locals.user.id),
				duesType: duesType
			}
		});

		return json({ clientSecret: paymentIntent.client_secret });
	} catch (e) {
		console.error('[Stripe] Failed to create payment intent:', e);
		throw error(500, 'Failed to initialize payment');
	}
};
