import { prisma } from '$lib/server/prisma';
import { authCookieOptions } from '$lib/server/security';
import { fail, redirect } from '@sveltejs/kit';
import { compare } from 'bcrypt';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';

const schema = z.object({
	discordUserName: z.string().trim().min(1, 'Discord username is required'),
	password: z.string().min(1, 'Password is required')
});

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) throw redirect(302, '/dashboard');
	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const formData = await request.formData();
		const data = Object.fromEntries(formData);
		const parsed = schema.safeParse(data);

		if (!parsed.success) {
			return fail(400, {
				field: parsed.error.issues[0].path[0] as string,
				error: parsed.error.issues[0].message,
				data
			});
		}

		const user = await prisma.user.findFirst({
			where: { discordUserName: { equals: parsed.data.discordUserName, mode: 'insensitive' } }
		});

		if (!user) {
			return fail(400, {
				field: 'discordUserName',
				error: 'No account found with that Discord username.',
				data
			});
		}

		const validPass = await compare(parsed.data.password, user.passwordHash);
		if (!validPass) {
			return fail(400, { field: 'password', error: 'Incorrect password.', data });
		}

		const authToken = randomUUID();
		await prisma.user.update({ where: { id: user.id }, data: { authToken } });

		cookies.set('auth', authToken, {
			...authCookieOptions,
			maxAge: 60 * 60 * 24 * 7
		});

		throw redirect(302, '/dashboard');
	}
};
