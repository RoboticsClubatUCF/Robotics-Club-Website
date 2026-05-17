import { prisma } from '$lib/server/prisma';
import { assertSameOrigin, requirePermission } from '$lib/server/security';
import { json, error } from '@sveltejs/kit';
import { Prisma } from '@prisma/client';
import { syncMemberRoles } from '$lib/discord';
import { z } from 'zod';
import type { RequestHandler } from './$types';

const bodySchema = z.object({
	firstName: z.string().trim().min(1).max(80).optional(),
	lastName: z.string().trim().max(80).nullable().optional(),
	ucfEmail: z.string().trim().toLowerCase().email().optional(),
	discordUserName: z.string().trim().min(1).max(64).optional()
});

export const PATCH: RequestHandler = async ({ params, request, locals, url, fetch }) => {
	assertSameOrigin(request, url);
	requirePermission(locals);

	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) throw error(400, 'Invalid user ID');

	const parsed = bodySchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success || Object.keys(parsed.data).length === 0) {
		throw error(400, 'Invalid user payload');
	}

	const user = await prisma.user.findUnique({
		where: { id },
		include: { role: true }
	});

	if (!user) throw error(404, 'User not found');

	try {
		const updated = await prisma.user.update({
			where: { id },
			data: parsed.data,
			select: { id: true, firstName: true, lastName: true, ucfEmail: true, discordUserName: true }
		});

		if (parsed.data.discordUserName && parsed.data.discordUserName !== user.discordUserName) {
			await syncMemberRoles(updated.discordUserName, [user.roleName], fetch).catch((e) =>
				console.error('[Discord sync] Failed during admin user patch:', e)
			);
		}

		return json(updated);
	} catch (e) {
		if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
			throw error(409, 'Email or Discord username is already in use');
		}
		throw e;
	}
};
