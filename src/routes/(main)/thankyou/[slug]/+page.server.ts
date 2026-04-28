import { db } from '$lib/db';
import { calculateValidSemester } from '../../../../components/scripts/dates';
import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

export const load = (async ({ params, locals }) => {
  if (!locals.member?.email) {
    throw redirect(302, '/');
  }

  const self = await db.member.findFirst({
    where: { email: locals.member.email },
    select: { id: true, membershipExpDate: true, firstName: true }
  });

  // Slug must match the authenticated user — prevents one member upgrading another
  if (!self || self.id !== params.slug) {
    throw redirect(302, '/dashboard');
  }

  const updated = await db.member.update({
    where: { id: self.id },
    data: {
      membershipExpDate: calculateValidSemester(self.membershipExpDate),
      role: {
        connect: { name: 'member' }
      }
    },
    select: { membershipExpDate: true }
  });

  return { firstName: self.firstName, membershipExpDate: updated.membershipExpDate };
}) satisfies PageServerLoad;
