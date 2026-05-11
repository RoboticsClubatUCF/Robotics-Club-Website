import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load = (async ({ locals }) => {
  if (locals.member.permissions.level < 7) {
    throw redirect(302, '/dashboard');
  }
}) satisfies PageServerLoad;
