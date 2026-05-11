import { error, json } from '@sveltejs/kit';
import { runCalendarDiagnostics } from '$lib/ucfCalendar';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.member || locals.member.permissions.level < 10) {
    throw error(403, 'Forbidden');
  }
  const lines = await runCalendarDiagnostics();
  return json({ lines });
};
