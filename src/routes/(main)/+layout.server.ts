import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, cookies }) => {
  const permissionLevel = locals.member?.permissions.level ?? 0;
  const canEdit = permissionLevel >= 10;
  const editMode = canEdit && cookies.get('editMode') === 'true';

  return {
    user: !!locals.member,
    canEdit,
    editMode,
    permissionLevel
  };
};
