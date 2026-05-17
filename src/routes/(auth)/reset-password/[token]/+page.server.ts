import { prisma } from '$lib/server/prisma';
import { fail, redirect } from '@sveltejs/kit';
import { hash } from 'bcrypt';
import { createHash, randomUUID } from 'crypto';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';

const schema = z.object({
	password: z.string().min(8, 'Password must be at least 8 characters'),
	confirmPassword: z.string()
});

function hashResetToken(token: string) {
	return createHash('sha256').update(token).digest('hex');
}

export const load: PageServerLoad = async ({ params }) => {
	const record = await prisma.passwordResetToken.findUnique({
		where: { token: hashResetToken(params.token) }
	});

	if (!record || record.expiresAt < new Date()) {
		throw redirect(302, '/forgot-password');
	}

	return { token: params.token };
};

export const actions: Actions = {
	default: async ({ params, request }) => {
		const data = await request.formData();
		const parsed = schema.safeParse(Object.fromEntries(data));

		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0].message });
		}

		if (parsed.data.password !== parsed.data.confirmPassword) {
			return fail(400, { error: 'Passwords do not match.' });
		}

		const record = await prisma.passwordResetToken.findUnique({
			where: { token: hashResetToken(params.token) }
		});

		if (!record || record.expiresAt < new Date()) {
			return fail(400, { error: 'Reset link has expired. Request a new one.' });
		}

		await prisma.$transaction([
			prisma.user.update({
				where: { id: record.userId },
				data: { passwordHash: await hash(parsed.data.password, 12), authToken: randomUUID() }
			}),
			prisma.passwordResetToken.delete({ where: { id: record.id } })
		]);

		throw redirect(302, '/signin');
	}
};
