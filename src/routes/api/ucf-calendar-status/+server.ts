import { runCalendarDiagnostics } from '$lib/ucfCalendar';
import { requirePermission } from '$lib/server/security';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	requirePermission(locals);

	const lines = await runCalendarDiagnostics();
	return json({ lines });
};
