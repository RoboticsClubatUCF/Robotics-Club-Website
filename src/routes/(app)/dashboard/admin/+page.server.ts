import { db } from '$lib/db';
import { syncMemberRoles } from '$lib/discord';
import { redirect, error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

// Roles the viewer can assign based on their own permission level.
// Each tier inherits what the tier below it can assign.
function manageableRoleNames(viewerLevel: number): string[] {
  if (viewerLevel >= 999) return ['officer', 'lead', 'team lead', 'member'];
  if (viewerLevel >= 10)  return ['lead', 'team lead', 'member'];
  if (viewerLevel >= 8)   return ['team lead'];
  return [];
}

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.member.permissions.level < 8) {
    throw redirect(302, '/dashboard');
  }

  const members = await db.member.findMany({
    include: { role: true, roles: true },
    orderBy: [{ role: { permissionLevel: 'desc' } }, { firstName: 'asc' }]
  });

  const roles = await db.role.findMany({
    orderBy: { permissionLevel: 'desc' }
  });

  return {
    members,
    roles,
    viewerLevel: locals.member.permissions.level
  };
};

export const actions: Actions = {
  updateRoles: async ({ request, locals }) => {
    const viewerLevel = locals.member.permissions.level;
    if (viewerLevel < 8) throw error(403, 'Insufficient permissions');

    const form = await request.formData();
    const memberId = form.get('memberId')?.toString();
    if (!memberId) return fail(400, { memberId: '', error: 'Missing member ID' });

    const selectedRoleNames = form.getAll('role').map((v) => v.toString());

    // Mutual exclusivity: project lead and team lead cannot coexist
    if (selectedRoleNames.includes('lead') && selectedRoleNames.includes('team lead')) {
      return fail(400, {
        memberId,
        error: 'Project lead and team lead are mutually exclusive — choose one.'
      });
    }

    // Only process roles the viewer is allowed to assign
    const manageable = manageableRoleNames(viewerLevel);
    const validSelected = selectedRoleNames.filter((n) => manageable.includes(n));

    // Fetch all roles for ID lookup
    const allRoles = await db.role.findMany();
    const roleByName = new Map(allRoles.map((r) => [r.name, r]));
    const guestRole = allRoles.find((r) => r.permissionLevel === 0);
    if (!guestRole) throw error(500, 'Guest role not found');

    // Load the target member's current roles (to preserve non-manageable ones)
    const target = await db.member.findUnique({
      where: { id: memberId },
      include: { roles: true }
    });
    if (!target) return fail(404, { memberId, error: 'Member not found' });

    // Preserve roles the viewer cannot touch
    const preserved = target.roles.filter((r) => !manageable.includes(r.name));

    // Build the new full role set
    const newRoleObjects = [
      ...preserved,
      ...validSelected.map((n) => roleByName.get(n)).filter(Boolean)
    ] as typeof allRoles;

    // Primary role = highest permission level in the new set (or guest)
    const maxRole = newRoleObjects.reduce(
      (max, r) => (r.permissionLevel > max.permissionLevel ? r : max),
      guestRole
    );

    await db.member.update({
      where: { id: memberId },
      data: {
        role: { connect: { id: maxRole.id } },
        roles: { set: newRoleObjects.map((r) => ({ id: r.id })) }
      }
    });

    // Sync Discord with the full new role set
    const discordResult = await syncMemberRoles(
      target.discordProfileName,
      newRoleObjects.map((r) => r.name)
    );
    if (!discordResult.success) {
      console.error('[Discord role sync]', target.discordProfileName, discordResult.error);
    }

    return { memberId, success: true, discordSynced: discordResult.success };
  }
};
