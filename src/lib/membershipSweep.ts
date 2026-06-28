import { db } from '$lib/db';
import { syncMemberRoles, removeProjectRole } from '$lib/discord';
import { getCurrentSemester, getGracePeriodInfo } from '$lib/currentSemester';
import config from '../config';
import { Season } from '@prisma/client';

export async function sweepExpiredMemberships(): Promise<string[]> {
	const lines: string[] = [];
	const now = new Date();
	lines.push(`Sweep started at ${now.toISOString()}`);

	const [{ semester }, { inGrace }] = await Promise.all([
		getCurrentSemester(),
		getGracePeriodInfo()
	]);

	// Removal is driven by each member's actual membershipExpDate, but is paused
	// during the windows the rest of the app also exempts (see dashboard load and
	// the (app) layout, which apply the same guards):
	//   • Summer — membership is free, so expired members aren't demoted.
	//   • Grace period — returning members get 14 days to renew before losing roles.
	// These are anchored to the semester-change dates; without these guards the
	// hourly sweep would strip roles the website otherwise protects.
	if (semester === Season.Summer) {
		lines.push('Summer period — membership enforcement paused; no roles removed.');
		lines.push('Done.');
		return lines;
	}

	if (inGrace) {
		lines.push('Grace period — membership enforcement paused; no roles removed.');
		lines.push('Done.');
		return lines;
	}

	const expired = await db.member.findMany({
		where: {
			membershipExpDate: { lt: now },
			role: {
				// All non-guest, non-admin roles: member (4), committee (6), team lead (7),
				// project lead (8), and officer (10). Admins (999) are never touched automatically.
				permissionLevel: { gte: 4, lt: 999 }
			}
		},
		include: {
			role: true,
			roles: true,
			Projects: { select: { id: true, discordRoleId: true } }
		}
	});

	if (expired.length === 0) {
		lines.push('No expired memberships found.');
		lines.push('Done.');
		return lines;
	}

	lines.push(`Found ${expired.length} expired membership(s).`);

	const guestRole = await db.role.findFirst({
		where: { name: config.roles.guest.name }
	});

	if (!guestRole) {
		lines.push('ERROR: No guest role found in database.');
		return lines;
	}

	for (const member of expired) {
		// Leads, team leads, and officers keep their organizational roles when expired;
		// only project assignments are removed. Members and committee get demoted to guest.
		const isPrivilegedRole = member.role.permissionLevel >= config.roles.teamLead.level;

		lines.push(`Processing: ${member.discordProfileName}`);

		for (const project of member.Projects) {
			if (project.discordRoleId !== '1111111') {
				const result = await removeProjectRole(member.discordProfileName, project.discordRoleId).catch(
					(e) => ({ success: false, error: String(e) })
				);
				if (!result.success) {
					lines.push(`  [Discord] Remove project role ${project.discordRoleId} failed: ${result.error}`);
				} else {
					lines.push(`  Removed project role ${project.discordRoleId}`);
				}
				await new Promise((r) => setTimeout(r, 300));
			}
		}

		if (isPrivilegedRole) {
			const keepRoles = member.roles.filter((r) => r.permissionLevel >= config.roles.teamLead.level);
			if (!keepRoles.some((r) => r.id === member.role.id)) keepRoles.push(member.role);
			await db.member.update({
				where: { id: member.id },
				data: {
					roles: { set: keepRoles.map((r) => ({ id: r.id })) },
					Projects: { set: [] }
				}
			});
			lines.push(`  Privileged role — project roles cleared, organizational roles preserved.`);
		} else {
			const effectiveRoles = member.roles.length > 0 ? member.roles : [member.role];
			const keepRoles = effectiveRoles.filter((r) => r.permissionLevel >= config.roles.officer.level);
			const newRoles = [...keepRoles, guestRole];
			const newPrimaryRole = newRoles.reduce(
				(max, r) => (r.permissionLevel > max.permissionLevel ? r : max),
				guestRole
			);

			await db.member.update({
				where: { id: member.id },
				data: {
					role: { connect: { id: newPrimaryRole.id } },
					roles: { set: newRoles.map((r) => ({ id: r.id })) },
					Projects: { set: [] }
				}
			});

			const syncResult = await syncMemberRoles(
				member.discordProfileName,
				keepRoles.map((r) => r.name)
			);
			if (!syncResult.success) {
				lines.push(`  [Discord] Role sync failed: ${syncResult.error}`);
			} else {
				lines.push(`  Role -> ${newPrimaryRole.name} (level ${newPrimaryRole.permissionLevel})`);
			}
		}

		await new Promise((r) => setTimeout(r, 500));
	}

	lines.push(`Done. Expired ${expired.length} membership(s).`);
	return lines;
}
