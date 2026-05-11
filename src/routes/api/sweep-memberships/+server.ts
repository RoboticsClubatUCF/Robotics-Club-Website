import { error, json } from '@sveltejs/kit';
import { sweepExpiredMemberships } from '$lib/membershipSweep';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.member || locals.member.permissions.level < 10) {
		throw error(403, 'Forbidden');
	}
	const lines = await sweepExpiredMemberships();
	return json({ lines });
};
