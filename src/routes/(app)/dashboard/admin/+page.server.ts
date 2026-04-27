import { db } from '$lib/db';
import { redirect, error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.member.permissions.level <= 5) {
    throw redirect(302, '/');
  }

  const members = await db.member.findMany({
    include: { role: true },
    orderBy: [{ role: { permissionLevel: 'desc' } }, { firstName: 'asc' }]
  });

  const roles = await db.role.findMany({
    orderBy: { permissionLevel: 'desc' }
  });

  return {
    members,
    roles,
    isAdmin: locals.member.permissions.level >= 999
  };
};

export const actions: Actions = {
  assignRole: async ({ request, locals }) => {
    if (locals.member.permissions.level < 999) {
      throw error(403, 'Only admins can assign roles');
    }

    const form = await request.formData();
    const memberId = form.get('memberId')?.toString();
    const roleName = form.get('roleName')?.toString();

    if (!memberId || !roleName) return;

    const role = await db.role.findUnique({ where: { name: roleName } });
    if (!role) return;

    await db.member.update({
      where: { id: memberId },
      data: { roleId: role.id }
    });
  }
};
