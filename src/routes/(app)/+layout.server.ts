import { db } from '$lib/db';
import { error, redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { getCurrentSemester, isInGracePeriod } from '$lib/currentSemester';

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
  // Admins are exempt. During the 14-day grace period at the start of fall/spring,
  // expired members are allowed through so they can re-enroll in projects before paying.
  if (!isAdmin && member.membershipExpDate < new Date()) {
    const dateInfo = await getCurrentSemester();
    const inGracePeriod = await isInGracePeriod(dateInfo.semester, dateInfo.year);
    if (!inGracePeriod) {
      if (!url.pathname.startsWith('/dashboard/acknowledge')) {
        throw redirect(302, '/dashboard/acknowledge');
      }
    }
  }

  return { fname, member };
};
