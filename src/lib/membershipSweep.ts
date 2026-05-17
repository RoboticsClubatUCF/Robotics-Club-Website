import { prisma } from '$lib/server/prisma';
import { syncMemberRoles, removeProjectRole } from '$lib/discord';
import { getCurrentSemester, getGracePeriodInfo } from '$lib/currentSemester';
import { ROLES } from '$lib/constants';

export async function sweepExpiredMemberships(): Promise<string[]> {
	const lines: string[] = [];
	const now = new Date();
	lines.push(`Sweep started at ${now.toISOString()}`);

	const [{ semester }, { inGrace }] = await Promise.all([
		getCurrentSemester(),
		getGracePeriodInfo()
	]);

	if (semester === 'summer') {
		lines.push('Summer period — sweeping expired memberships.');
	}
	if (inGrace) {
		lines.push('Grace period — sweeping expired memberships.');
	}

	const expired = await prisma.user.findMany({
		where: {
			membershipExpDate: { lt: now },
			role: { permissionLevel: { gte: ROLES.member.level, lt: ROLES.admin.level } }
		},
		include: {
			role: true,
			projectUsers: {
				include: { project: { select: { id: true, discordRoleId: true } } }
			}
		}
	});

	if (expired.length === 0) {
		lines.push('No expired memberships found.');
		lines.push('Done.');
		return lines;
	}

	lines.push(`Found ${expired.length} expired membership(s).`);

	for (const user of expired) {
		const isPrivileged = user.role.permissionLevel >= ROLES.teamLead.level;
		lines.push(`Processing: ${user.discordUserName}`);

		for (const pu of user.projectUsers) {
			const roleId = pu.project.discordRoleId;
			if (roleId) {
				const result = await removeProjectRole(user.discordUserName, roleId).catch((e) => ({
					success: false,
					error: String(e)
				}));
				if (!result.success) {
					lines.push(`  [Discord] Remove project role ${roleId} failed: ${result.error}`);
				} else {
					lines.push(`  Removed project role ${roleId}`);
				}
				await new Promise((r) => setTimeout(r, 300));
			}
		}

		await prisma.projectUser.deleteMany({ where: { userId: user.id } });

		if (isPrivileged) {
			lines.push(
				`  Privileged role (${user.roleName}) — project roles cleared, main role preserved.`
			);
		} else {
			await prisma.user.update({
				where: { id: user.id },
				data: { roleName: ROLES.guest.name }
			});

			const syncResult = await syncMemberRoles(user.discordUserName, []);
			if (!syncResult.success) {
				lines.push(`  [Discord] Role sync failed: ${syncResult.error}`);
			} else {
				lines.push(`  Role -> guest (level 0)`);
			}
		}

		await new Promise((r) => setTimeout(r, 500));
	}

	lines.push(`Done. Expired ${expired.length} membership(s).`);
	return lines;
}
