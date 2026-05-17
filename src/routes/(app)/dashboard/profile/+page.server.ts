import { prisma } from '$lib/server/prisma';
import { authCookieOptions } from '$lib/server/security';
import { fail, redirect } from '@sveltejs/kit';
import { Prisma } from '@prisma/client';
import { assignMemberRole } from '$lib/discord';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';

const profileSchema = z.object({
	firstName: z.string().trim().min(1, 'First name is required').max(80),
	lastName: z.string().trim().max(80).optional(),
	discordUserName: z.string().trim().min(1, 'Discord username is required').max(64),
	ucfEmail: z.string().trim().toLowerCase().email('Valid email required')
});

export const load: PageServerLoad = async ({ locals }) => {
	const user = await prisma.user.findUnique({
		where: { id: locals.user!.id },
		include: { role: true, profileImage: true }
	});
	return { user };
};

export const actions: Actions = {
	updateProfile: async ({ request, locals, fetch }) => {
		if (!locals.user) return fail(401);

		const data = await request.formData();
		const parsed = profileSchema.safeParse(Object.fromEntries(data));

		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0].message });
		}

		const current = await prisma.user.findUnique({
			where: { id: locals.user.id },
			select: { discordUserName: true }
		});

		if (!current) return fail(404);

		try {
			await prisma.user.update({
				where: { id: locals.user.id },
				data: {
					firstName: parsed.data.firstName,
					lastName: parsed.data.lastName || null,
					ucfEmail: parsed.data.ucfEmail,
					discordUserName: parsed.data.discordUserName
				}
			});
		} catch (e) {
			if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
				return fail(409, { error: 'Email or Discord username is already in use.' });
			}
			throw e;
		}

		const discordChanged = current.discordUserName !== parsed.data.discordUserName;
		if (discordChanged) {
			const result = await assignMemberRole(parsed.data.discordUserName, fetch);
			return { success: true, discordSynced: result.success };
		}

		return { success: true, discordSynced: true };
	},

	deleteAccount: async ({ request, locals, cookies }) => {
		if (!locals.user) return fail(401);

		const data = await request.formData();
		const confirm1 = data.get('confirmName1') as string;
		const confirm2 = data.get('confirmName2') as string;

		const user = await prisma.user.findUnique({
			where: { id: locals.user.id },
			select: { firstName: true, lastName: true }
		});

		if (!user) return fail(404);

		const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');

		if (confirm1 !== fullName || confirm2 !== fullName) {
			return fail(400, { deleteError: 'Names do not match. Enter your full name exactly.' });
		}

		await prisma.user.delete({ where: { id: locals.user.id } });

		cookies.delete('auth', authCookieOptions);
		throw redirect(302, '/');
	}
};
