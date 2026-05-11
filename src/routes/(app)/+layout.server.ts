import { db } from '$lib/db';
import { error, redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { getCurrentSemester, isInGracePeriod } from '$lib/currentSemester';
import config from '../../config';

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
      // Immediately strip member-and-below roles so the DB stays consistent with
      // the expiration. Officers keep their officer role; the hourly sweep does
      // the same but this closes the timing gap.
      const memberRolesToRemove = member.roles.filter(
        (r) => r.permissionLevel <= config.roles.member.level
      );
      if (memberRolesToRemove.length > 0) {
        await db.member.update({
          where: { id: member.id },
          data: {
            roles: { disconnect: memberRolesToRemove.map((r) => ({ id: r.id })) },
            // Non-officer users also get their primary role reset to guest.
            ...(member.role.permissionLevel <= config.roles.member.level &&
              member.role.name !== config.roles.guest.name && {
                role: {
                  connectOrCreate: {
                    where: { name: config.roles.guest.name },
                    create: {
                      permissionLevel: config.roles.guest.level,
                      name: config.roles.guest.name
                    }
                  }
                }
              })
          }
        });
      }
      if (!url.pathname.startsWith('/dashboard/acknowledge')) {
        throw redirect(302, '/dashboard/acknowledge');
      }
    }
  }

  return { fname, member };
};
