import { db } from '$lib/db';
import { error, redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import semesterYear from '../../components/scripts/semesterYear';

export const load: LayoutServerLoad = async ({ locals }) => {
  if (!locals.member) {
    throw redirect(302, '/');
  }
  const fname = locals.member.fname;
  const member = await db.member.findFirst({
    where: {
      email: locals.member.email
    },
    include: {
      Projects: true
    }
  });
  if (member == null) {
    throw error(404, 'Member does not exist');
  }
  return { fname, member };
};
