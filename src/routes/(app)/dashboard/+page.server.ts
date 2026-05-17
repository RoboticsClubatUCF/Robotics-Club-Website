import { prisma } from '$lib/server/prisma';
import { parseId } from '$lib/server/security';
import { fail } from '@sveltejs/kit';
import { getCurrentSemester, getGracePeriodInfo } from '$lib/currentSemester';
import { getSemesterEndDate } from '$lib/ucfCalendar';
import { assignMemberRole, assignProjectRole } from '$lib/discord';
import { ROLES } from '$lib/constants';
import { Season } from '@prisma/client';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const today = new Date();
	const year = today.getFullYear();

	const [dateInfo, springEnd, summerEnd, gracePeriod] = await Promise.all([
		getCurrentSemester(),
		getSemesterEndDate(year, 'spring'),
		getSemesterEndDate(year, 'summer'),
		getGracePeriodInfo()
	]);

	const isSummerPeriod = today >= springEnd && today <= summerEnd;
	const { inGrace, expiry: gracePeriodExpiry } = gracePeriod;

	const user = await prisma.user.findUnique({
		where: { id: locals.user!.id },
		include: {
			role: true,
			survey: true,
			projectUsers: {
				where: { project: { year: dateInfo.year, season: dateInfo.semester } },
				include: { project: { include: { logo: true } } }
			}
		}
	});

	const userProjectIds = user?.projectUsers.map((pu) => pu.projectId) ?? [];

	const joinableProjects = await prisma.project.findMany({
		where: {
			year: dateInfo.year,
			season: dateInfo.semester,
			id: { notIn: userProjectIds }
		},
		include: { logo: true }
	});

	return {
		user,
		joinableProjects,
		isSummerPeriod,
		isGracePeriod: inGrace,
		gracePeriodExpiry,
		currentYear: dateInfo.year,
		currentSemester: dateInfo.semester
	};
};

export const actions: Actions = {
	joinProject: async ({ request, locals, fetch }) => {
		if (!locals.user) return fail(401, { error: 'Not logged in' });

		const data = await request.formData();
		const projectId = parseId(data.get('projectId'));
		if (!projectId) return fail(400, { error: 'Invalid project ID' });

		const self = await prisma.user.findUnique({
			where: { id: locals.user.id },
			select: { id: true, membershipExpDate: true, survey: true, discordUserName: true }
		});

		if (!self) return fail(404, { error: 'User not found' });
		if (!self.survey)
			return fail(403, { error: 'Complete your member survey before joining a project' });

		const dateInfo = await getCurrentSemester();
		const duesActive = self.membershipExpDate > new Date();

		if (dateInfo.semester !== Season.summer && !duesActive) {
			return fail(403, { error: 'Active membership required to join a project' });
		}

		const project = await prisma.project.findUnique({
			where: { id: projectId },
			select: { id: true, year: true, season: true, discordRoleId: true }
		});

		if (!project) return fail(404, { error: 'Project not found' });

		if (project.year !== dateInfo.year || project.season !== dateInfo.semester) {
			return fail(400, { error: 'You can only join projects from the current semester' });
		}

		const existing = await prisma.projectUser.findUnique({
			where: { projectId_userId: { projectId, userId: self.id } }
		});
		if (existing) return fail(400, { error: 'Already a member of this project' });

		await prisma.projectUser.create({ data: { projectId, userId: self.id } });

		if (project.discordRoleId) {
			assignProjectRole(self.discordUserName, project.discordRoleId, fetch).catch(() => {});
		}

		return { success: true };
	},

	graceRole: async ({ request, locals, fetch }) => {
		if (!locals.user) return fail(401);

		const data = await request.formData();
		const id = parseId(data.get('id'));
		if (id !== locals.user.id) return fail(403);

		const { inGrace, expiry } = await getGracePeriodInfo();
		if (!inGrace || !expiry) return fail(400, { error: 'Not in grace period' });

		const currentLevel = locals.user.role.permissionLevel;
		const newRoleName =
			currentLevel >= ROLES.member.level ? locals.user.role.name : ROLES.member.name;

		await prisma.user.update({
			where: { id },
			data: { membershipExpDate: expiry, roleName: newRoleName }
		});

		assignMemberRole(locals.user.discordUserName, fetch).catch(() => {});
	},

	summerRole: async ({ request, locals, fetch }) => {
		if (!locals.user) return fail(401);

		const data = await request.formData();
		const id = parseId(data.get('id'));
		if (id !== locals.user.id) return fail(403);

		const currentYear = new Date().getFullYear();
		const today = new Date();
		const springEnd = await getSemesterEndDate(currentYear, 'spring');
		const expDate = await getSemesterEndDate(currentYear, 'summer');
		if (today < springEnd || today > expDate) {
			return fail(400, { error: 'Summer membership is only available during summer term' });
		}

		const currentLevel = locals.user.role.permissionLevel;
		const newRoleName =
			currentLevel >= ROLES.member.level ? locals.user.role.name : ROLES.member.name;

		await prisma.user.update({
			where: { id },
			data: { membershipExpDate: expDate, roleName: newRoleName }
		});

		assignMemberRole(locals.user.discordUserName, fetch).catch(() => {});
	}
};
