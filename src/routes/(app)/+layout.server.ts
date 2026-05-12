import { db } from '$lib/db';
import { error, redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { syncMemberRoles } from '$lib/discord';
import { getGracePeriodInfo } from '$lib/currentSemester';
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
  // Admins and members in the 14-day grace period at the start of fall/spring are exempt.
  if (!isAdmin && member.membershipExpDate < new Date()) {
    const { inGrace } = await getGracePeriodInfo();
    if (!inGrace) {
      const memberRolesToRemove = member.roles.filter(
        (r) => r.permissionLevel < config.roles.officer.level
      );
      if (memberRolesToRemove.length > 0) {
        await db.member.update({
          where: { id: member.id },
          data: {
            roles: { disconnect: memberRolesToRemove.map((r) => ({ id: r.id })) },
            ...(member.role.permissionLevel < config.roles.officer.level &&
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
        const keepRoles = member.roles.filter((r) => r.permissionLevel >= config.roles.officer.level);
        syncMemberRoles(member.discordProfileName, keepRoles.map((r) => r.name)).catch(
          (e) => console.error('[Discord sync on expiry]', e)
        );
      }
      if (!url.pathname.startsWith('/dashboard/acknowledge')) {
        throw redirect(302, '/dashboard/acknowledge');
      }
    }
  }

  return { fname, member };
};
