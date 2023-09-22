import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load = (async ({ locals }) => {
  if (locals.member.permissions.level <= 5) {
    // lowwer than a committee member
    throw redirect(302, '/');
  }
  return {};
}) satisfies PageServerLoad;
