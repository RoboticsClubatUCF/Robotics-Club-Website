import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, cookies }) => {
	const permissionLevel = locals.user?.role.permissionLevel ?? 0;
	const canEdit = permissionLevel >= 10;
	const editMode = canEdit && cookies.get('editMode') === 'true';

	return {
		user: !!locals.user,
		canEdit,
		editMode,
		permissionLevel
	};
};
