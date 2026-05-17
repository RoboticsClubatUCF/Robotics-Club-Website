import { prisma } from '$lib/server/prisma';
import { parseId } from '$lib/server/security';
import { syncMemberRoles } from '$lib/discord';
import { redirect, error, fail } from '@sveltejs/kit';
import { getCurrentSemester } from '$lib/currentSemester';
import { getSemesterEndDate } from '$lib/ucfCalendar';
import { Season } from '@prisma/client';
import { ROLES } from '$lib/constants';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user!.role.permissionLevel < ROLES.teamLead.level) {
		throw redirect(302, '/dashboard');
	}

	const [users, roles] = await Promise.all([
		prisma.user.findMany({
			include: { role: true },
			orderBy: [{ role: { permissionLevel: 'desc' } }, { firstName: 'asc' }]
		}),
		prisma.role.findMany({ orderBy: { permissionLevel: 'desc' } })
	]);

	return { users, roles, viewerLevel: locals.user!.role.permissionLevel };
};

export const actions: Actions = {
	updateRoles: async ({ request, locals, fetch }) => {
		const viewerLevel = locals.user!.role.permissionLevel;
		if (viewerLevel < ROLES.teamLead.level) throw error(403, 'Insufficient permissions');

		const form = await request.formData();
		const userId = parseId(form.get('userId'));
		const roleName = (form.get('roleName') as string)?.trim();

		if (!userId || !roleName) return fail(400, { error: 'Missing fields' });

		const targetRole = await prisma.role.findUnique({ where: { name: roleName } });
		if (!targetRole) return fail(400, { error: 'Invalid role' });

		if (targetRole.permissionLevel > viewerLevel) {
			return fail(403, { error: 'Cannot assign a role higher than your own' });
		}

		const target = await prisma.user.findUnique({
			where: { id: userId },
			include: { role: true }
		});
		if (!target) return fail(404, { error: 'User not found' });
		if (target.role.permissionLevel >= viewerLevel && target.id !== locals.user!.id) {
			return fail(403, { error: 'Cannot modify a user with equal or higher permissions' });
		}
		if (target.id === locals.user!.id && targetRole.permissionLevel < viewerLevel) {
			return fail(403, { error: 'Cannot lower your own role' });
		}

		await prisma.user.update({
			where: { id: userId },
			data: { roleName }
		});

		const discordResult = await syncMemberRoles(target.discordUserName, [roleName], fetch);
		if (!discordResult.success) {
			console.error('[Discord role sync]', target.discordUserName, discordResult.error);
		}

		return { userId, success: true, discordSynced: discordResult.success };
	},

	grantMembership: async ({ request, locals, fetch }) => {
		const viewerLevel = locals.user!.role.permissionLevel;
		if (viewerLevel < ROLES.officer.level) throw error(403, 'Officers and admins only');

		const form = await request.formData();
		const userId = parseId(form.get('userId'));
		const duration = form.get('duration') as string;

		if (!userId) return fail(400, { error: 'Missing user ID' });
		if (duration !== 'semester' && duration !== 'year') {
			return fail(400, { error: 'Duration must be "semester" or "year"' });
		}

		const target = await prisma.user.findUnique({
			where: { id: userId },
			include: { role: true }
		});
		if (!target) return fail(404, { error: 'User not found' });

		const dateInfo = await getCurrentSemester();

		let expDate: Date;
		if (duration === 'year') {
			const springYear = dateInfo.semester === Season.fall ? dateInfo.year + 1 : dateInfo.year;
			expDate = await getSemesterEndDate(springYear, 'spring');
		} else {
			const ucfSeason =
				dateInfo.semester === Season.fall
					? 'fall'
					: dateInfo.semester === Season.summer
						? 'summer'
						: 'spring';
			expDate = await getSemesterEndDate(dateInfo.year, ucfSeason);
		}

		const newRoleName =
			target.role.permissionLevel >= ROLES.member.level ? target.roleName : ROLES.member.name;

		await prisma.user.update({
			where: { id: userId },
			data: { membershipExpDate: expDate, roleName: newRoleName }
		});

		const discordResult = await syncMemberRoles(target.discordUserName, [newRoleName], fetch);

		return { userId, grantSuccess: true, discordSynced: discordResult.success };
	}
};
