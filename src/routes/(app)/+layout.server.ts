import { db } from '$lib/db';
import { error, redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  if (!locals.member) {
    throw redirect(302, '/');
  }
  const fname = locals.member.fname;
  const member = await db.member.findFirst({
    where: {
      email: locals.member.email
    }
  });
  if (member == null) {
    throw error(404, 'Member does not exist');
  }
  return { fname, member };
};
