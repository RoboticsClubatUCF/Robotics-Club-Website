import { prisma } from '$lib/server/prisma';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [sponsors, siteContent] = await Promise.all([
		prisma.sponsor.findMany({
			where: { endedAt: null },
			include: { logo: true },
			orderBy: { startedAt: 'asc' }
		}),
		prisma.siteContent.findMany()
	]);

	return { sponsors, siteContent };
};
