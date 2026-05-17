import Stripe from 'stripe';
import { env } from '$env/dynamic/private';
import { prisma } from '$lib/server/prisma';
import { getCurrentSemester } from '$lib/currentSemester';
import { getSemesterEndDate } from '$lib/ucfCalendar';
import { assignMemberRole } from '$lib/discord';
import { error, json } from '@sveltejs/kit';
import { Season } from '@prisma/client';
import { DUES, ROLES } from '$lib/constants';
import { parseId } from '$lib/server/security';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, fetch }) => {
	const body = await request.text();
	const signature = request.headers.get('stripe-signature');

	if (!env.SECRET_STRIPE_KEY || !env.STRIPE_WEBHOOK_SECRET) {
		throw error(500, 'Stripe webhook is not configured');
	}
	if (!signature) {
		throw error(400, 'Missing Stripe signature');
	}

	let event: Stripe.Event;
	const stripe = new Stripe(env.SECRET_STRIPE_KEY);

	try {
		event = stripe.webhooks.constructEvent(body, signature, env.STRIPE_WEBHOOK_SECRET);
	} catch (err) {
		console.error('[Stripe Webhook] Signature verification failed:', err);
		throw error(400, 'Invalid signature');
	}

	if (event.type === 'payment_intent.succeeded') {
		const paymentIntent = event.data.object as Stripe.PaymentIntent;
		const { userId, duesType } = paymentIntent.metadata;

		const expectedAmount =
			duesType === 'semester' || duesType === '1'
				? DUES.semester * 100
				: duesType === 'year' || duesType === '2'
					? DUES.year * 100
					: null;

		if (!userId || !expectedAmount) {
			console.error('[Stripe Webhook] Missing metadata in payment intent:', paymentIntent.id);
			return json({ received: true });
		}
		if (paymentIntent.currency !== 'usd' || paymentIntent.amount_received !== expectedAmount) {
			console.error('[Stripe Webhook] Payment amount mismatch:', paymentIntent.id);
			return json({ received: true });
		}

		const id = parseId(userId);
		if (!id) {
			console.error('[Stripe Webhook] Invalid user ID:', userId);
			return json({ received: true });
		}

		const user = await prisma.user.findUnique({
			where: { id },
			include: { role: true }
		});

		if (!user) {
			console.error('[Stripe Webhook] User not found:', userId);
			return json({ received: true });
		}

		const dateInfo = await getCurrentSemester();
		let expDate: Date;

		if (duesType === 'year' || duesType === '2') {
			const springYear = dateInfo.semester === Season.fall ? dateInfo.year + 1 : dateInfo.year;
			expDate = await getSemesterEndDate(springYear, 'spring');
		} else {
			const ucfSeason =
				dateInfo.semester === Season.fall
					? 'fall'
					: dateInfo.semester === Season.summer
						? 'summer'
						: 'spring';
			expDate = await getSemesterEndDate(dateInfo.year, ucfSeason);
		}

		const newRoleName =
			user.role.permissionLevel >= ROLES.member.level ? user.roleName : ROLES.member.name;

		await prisma.user.update({
			where: { id },
			data: {
				membershipExpDate: expDate,
				roleName: newRoleName
			}
		});

		await assignMemberRole(user.discordUserName, fetch).catch((e) =>
			console.error('[Stripe Webhook] Discord sync failed:', e)
		);

		console.log(`[Stripe Webhook] Membership updated for user ${user.discordUserName} (${id})`);
	}

	return json({ received: true });
};
