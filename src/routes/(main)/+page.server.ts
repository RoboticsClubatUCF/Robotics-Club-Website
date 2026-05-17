import { prisma } from '$lib/server/prisma';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [sponsors, siteContent, projectCount, memberCount] = await Promise.all([
		prisma.sponsor.findMany({
			where: { endedAt: null },
			include: { logo: true },
			orderBy: { startedAt: 'asc' }
		}),
		prisma.siteContent.findMany(),
		prisma.project.count(),
		prisma.user.count({
			where: {
				role: {
					permissionLevel: { gte: 4 }
				}
			}
		})
	]);

	return {
		sponsors,
		siteContent,
		projectCount,
		memberCount
	};
};
