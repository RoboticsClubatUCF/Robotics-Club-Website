import { sweepExpiredMemberships } from '$lib/membershipSweep';
import { assertSameOrigin, requirePermission } from '$lib/server/security';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request, url }) => {
	assertSameOrigin(request, url);
	requirePermission(locals);

	const lines = await sweepExpiredMemberships();
	return json({ lines });
};
