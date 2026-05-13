import { db } from '$lib/db';
import { syncMemberRoles } from '$lib/discord';
import { redirect, error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getCurrentSemester } from '$lib/currentSemester';
import { getSemesterEndDate } from '$lib/ucfCalendar';
import { Season } from '@prisma/client';

// Roles the viewer can assign based on their own permission level.
// Each tier inherits what the tier below it can assign.
function manageableRoleNames(viewerLevel: number): string[] {
  if (viewerLevel >= 999) return ['officer', 'project lead', 'team lead', 'member'];
  if (viewerLevel >= 10)  return ['project lead', 'team lead', 'member'];
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
  updateRoles: async ({ request, locals, fetch }) => {
    const viewerLevel = locals.member.permissions.level;
    if (viewerLevel < 8) throw error(403, 'Insufficient permissions');

    const form = await request.formData();
    const memberId = form.get('memberId')?.toString();
    if (!memberId) return fail(400, { memberId: '', error: 'Missing member ID' });

    const selectedRoleNames = form.getAll('role').map((v) => v.toString());

    // Mutual exclusivity: project lead and team lead cannot coexist
    if (selectedRoleNames.includes('project lead') && selectedRoleNames.includes('team lead')) {
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

    // Drop guest whenever any other role exists; fall back to guest only when empty
    const nonGuest = newRoleObjects.filter((r) => r.permissionLevel > 0);
    const finalRoles = nonGuest.length > 0 ? nonGuest : [guestRole];

    // Primary role = highest permission level in the final set
    const maxRole = finalRoles.reduce(
      (max, r) => (r.permissionLevel > max.permissionLevel ? r : max),
      guestRole
    );

    await db.member.update({
      where: { id: memberId },
      data: {
        // role always mirrors the highest entry in roles — handles both promotion and demotion.
        role: { connect: { id: maxRole.id } },
        roles: { set: finalRoles.map((r) => ({ id: r.id })) }
      }
    });

    // Sync Discord with the full new role set
    const discordResult = await syncMemberRoles(
      target.discordProfileName,
      finalRoles.map((r) => r.name),
      fetch
    );
    if (!discordResult.success) {
      console.error('[Discord role sync]', target.discordProfileName, discordResult.error);
    }

    return { memberId, success: true, discordSynced: discordResult.success };
  },

  // Officers and admins can grant membership manually (e.g. cash payments).
  // Duration: 'semester' sets expiry to end of current semester; 'year' sets it to end of spring.
  grantMembership: async ({ request, locals, fetch }) => {
    const viewerLevel = locals.member.permissions.level;
    if (viewerLevel < 10) throw error(403, 'Officers and admins only');

    const form = await request.formData();
    const memberId = form.get('memberId')?.toString();
    const duration = form.get('duration')?.toString();
    if (!memberId) return fail(400, { memberId: '', error: 'Missing member ID' });
    if (duration !== 'semester' && duration !== 'year') {
      return fail(400, { memberId, error: 'Duration must be "semester" or "year"' });
    }

    const target = await db.member.findUnique({
      where: { id: memberId },
      include: { roles: true, role: true }
    });
    if (!target) return fail(404, { memberId, error: 'Member not found' });

    const dateInfo = await getCurrentSemester();
    const year = new Date().getFullYear();

    let expDate: Date;
    if (duration === 'year') {
      // Year membership covers through end of spring. If we're currently in fall,
      // spring of the next calendar year is the target; otherwise current year's spring.
      const springYear = dateInfo.semester === Season.Fall ? year + 1 : year;
      expDate = await getSemesterEndDate(springYear, 'spring');
    } else {
      expDate = await getSemesterEndDate(year, dateInfo.semester === Season.Fall ? 'fall' : dateInfo.semester === Season.Summer ? 'summer' : 'spring');
    }

    const allRoles = await db.role.findMany();
    const memberRole = allRoles.find((r) => r.name === 'member');
    if (!memberRole) throw error(500, 'Member role not found');

    const existingRoles = target.roles;
    const withMember = existingRoles.some((r) => r.id === memberRole.id)
      ? existingRoles
      : [...existingRoles, memberRole];
    const newRoleSet = withMember.filter((r) => r.permissionLevel > 0);
    const primaryRole = newRoleSet.reduce(
      (max, r) => (r.permissionLevel > max.permissionLevel ? r : max),
      memberRole
    );

    await db.member.update({
      where: { id: memberId },
      data: {
        membershipExpDate: expDate,
        role: { connect: { id: primaryRole.id } },
        roles: { set: newRoleSet.map((r) => ({ id: r.id })) }
      }
    });

    const discordResult = await syncMemberRoles(
      target.discordProfileName,
      newRoleSet.map((r) => r.name),
      fetch
    );

    return { memberId, grantSuccess: true, discordSynced: discordResult.success };
  }
};
