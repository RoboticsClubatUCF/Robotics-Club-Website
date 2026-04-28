import { db } from '$lib/db';
import { error, redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import semesterYear from '../../components/scripts/semesterYear';

export const load: LayoutServerLoad = async ({ locals, url }) => {
  if (!locals.member) {
    throw redirect(302, '/');
  }
  const fname = locals.member.fname;
  const member = await db.member.findFirst({
    where: {
      email: locals.member.email
    },
    include: {
      Projects: true,
      role: true,
      roles: true
    }
  });

  if (member == null) {
    throw error(404, 'Member does not exist');
  }

  const isAdmin = member.role.permissionLevel >= 999;

  // Block expired members from all dashboard routes except the payment page.
  // Admins are exempt; officers, leads, and members are all checked.
  if (!isAdmin && member.membershipExpDate < new Date()) {
    if (!url.pathname.startsWith('/dashboard/acknowledge')) {
      throw redirect(302, '/dashboard/acknowledge');
    }
  }

  return { fname, member };
};
