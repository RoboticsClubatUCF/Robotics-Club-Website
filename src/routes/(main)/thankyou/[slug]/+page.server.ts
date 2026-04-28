import { db } from '$lib/db';
import { assignMemberRole } from '$lib/discord';
import { calculateValidSemester } from '../../../../components/scripts/dates';
import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

export const load = (async ({ params, locals, fetch }) => {
  if (!locals.member?.email) {
    throw redirect(302, '/');
  }

  const self = await db.member.findFirst({
    where: { email: locals.member.email },
    select: {
      id: true,
      membershipExpDate: true,
      firstName: true,
      discordProfileName: true,
      role: { select: { permissionLevel: true } }
    }
  });

  // Slug must match the authenticated user — prevents one member upgrading another
  if (!self || self.id !== params.slug) {
    throw redirect(302, '/dashboard');
  }

  // Build update: always extend expiry and add "member" to the roles set.
  // Only promote the primary role to "member" if the current level is below it,
  // so officers/admins who pay dues keep their higher primary role.
  const updateData: Parameters<typeof db.member.update>[0]['data'] = {
    membershipExpDate: calculateValidSemester(self.membershipExpDate),
    roles: { connect: { name: 'member' } }
  };
  if (self.role.permissionLevel < 4) {
    updateData.role = { connect: { name: 'member' } };
  }

  const updated = await db.member.update({
    where: { id: self.id },
    data: updateData,
    select: { membershipExpDate: true }
  });

  const discord = await assignMemberRole(self.discordProfileName, fetch);

  return {
    firstName: self.firstName,
    membershipExpDate: updated.membershipExpDate,
    discordSynced: discord.success
  };
}) satisfies PageServerLoad;
