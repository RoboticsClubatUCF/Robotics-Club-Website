import { prisma } from '$lib/server/prisma';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const projects = await prisma.project.findMany({
		include: {
			logo: true,
			users: {
				include: { user: true, role: true }
			}
		},
		orderBy: [{ year: 'desc' }, { season: 'asc' }]
	});

	return { projects };
};
