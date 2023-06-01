import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  if (!locals.member) {
    throw redirect(302, '/');
  }
  const fname = locals.member.fname;
  return { fname };
};
