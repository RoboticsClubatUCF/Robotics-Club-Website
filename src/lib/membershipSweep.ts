import { db } from '$lib/db';
import { syncMemberRoles, removeProjectRole } from '$lib/discord';

export async function sweepExpiredMemberships(): Promise<string[]> {
	const lines: string[] = [];
	const now = new Date();
	lines.push(`Sweep started at ${now.toISOString()}`);

	const expired = await db.member.findMany({
		where: {
			membershipExpDate: { lt: now },
			role: { permissionLevel: { gte: 4, lt: 999 } }
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
		where: { permissionLevel: 0 },
		orderBy: { permissionLevel: 'desc' }
	});

	if (!guestRole) {
		lines.push('ERROR: No guest role found in database.');
		return lines;
	}

	for (const member of expired) {
		const effectiveRoles = member.roles.length > 0 ? member.roles : [member.role];
		const keepRoles = effectiveRoles.filter((r) => r.permissionLevel >= 10);
		const newRoles = [...keepRoles, guestRole];
		const newPrimaryRole = newRoles.reduce(
			(max, r) => (r.permissionLevel > max.permissionLevel ? r : max),
			guestRole
		);

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

		await new Promise((r) => setTimeout(r, 500));
	}

	lines.push(`Done. Expired ${expired.length} membership(s).`);
	return lines;
}
