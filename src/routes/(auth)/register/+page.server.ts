import { prisma } from '$lib/server/prisma';
import { fail, redirect } from '@sveltejs/kit';
import { hash } from 'bcrypt';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';

const schema = z.object({
	firstName: z.string().trim().min(1, 'First name is required').max(80),
	lastName: z.string().trim().max(80).optional(),
	ucfEmail: z.string().trim().toLowerCase().email('Valid email required'),
	discordUserName: z.string().trim().min(1, 'Discord username is required').max(64),
	password: z.string().min(8, 'Password must be at least 8 characters'),
	confirmPassword: z.string()
});

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) throw redirect(302, '/dashboard');
	return {};
};

export const actions: Actions = {
	default: async ({ request }) => {
		const data = await request.formData();
		const parsed = schema.safeParse(Object.fromEntries(data));

		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0].message });
		}

		const { firstName, lastName, ucfEmail, discordUserName, password, confirmPassword } =
			parsed.data;

		if (password !== confirmPassword) {
			return fail(400, { error: 'Passwords do not match.' });
		}

		const [emailTaken, discordTaken] = await Promise.all([
			prisma.user.findUnique({ where: { ucfEmail } }),
			prisma.user.findUnique({ where: { discordUserName } })
		]);

		if (emailTaken) return fail(400, { field: 'ucfEmail', error: 'Email is already in use.' });
		if (discordTaken)
			return fail(400, { field: 'discordUserName', error: 'Discord username is already in use.' });

		await prisma.user.create({
			data: {
				firstName,
				lastName: lastName || null,
				ucfEmail,
				discordUserName,
				passwordHash: await hash(password, 12),
				roleName: 'guest'
			}
		});

		throw redirect(302, '/login');
	}
};
