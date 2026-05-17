import { prisma } from '$lib/server/prisma';
import { assertSameOrigin, requirePermission } from '$lib/server/security';
import { json, error } from '@sveltejs/kit';
import { ROLES } from '$lib/constants';
import { z } from 'zod';
import type { RequestHandler } from './$types';

const bodySchema = z.object({
	key: z.string().trim().min(1).max(120),
	value: z.string().max(100_000),
	type: z.string().trim().min(1).max(40).default('text')
});

export const GET: RequestHandler = async ({ url }) => {
	const key = url.searchParams.get('key');

	if (key) {
		const content = await prisma.siteContent.findUnique({ where: { key } });
		return json({ value: content?.value ?? null });
	}

	const all = await prisma.siteContent.findMany();
	return json(all);
};

export const POST: RequestHandler = async ({ request, locals, url }) => {
	assertSameOrigin(request, url);
	const user = requirePermission(locals, ROLES.officer.level);
	const parsed = bodySchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(400, 'Invalid site content payload');

	const { key, value, type } = parsed.data;

	const record = await prisma.siteContent.upsert({
		where: { key },
		create: { key, value, type, updatedBy: user.ucfEmail },
		update: { value, type, updatedBy: user.ucfEmail }
	});

	return json({ success: true, record });
};
