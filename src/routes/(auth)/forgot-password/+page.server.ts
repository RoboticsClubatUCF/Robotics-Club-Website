import { prisma } from '$lib/server/prisma';
import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { createHash, randomBytes } from 'crypto';
import { getEmailClient } from '$lib/server/email';
import type { Actions, PageServerLoad } from './$types';

const schema = z.object({
	ucfEmail: z.string().trim().toLowerCase().email('Valid email required')
});

function hashResetToken(token: string) {
	return createHash('sha256').update(token).digest('hex');
}

export const load: PageServerLoad = async () => {
	return {};
};

export const actions: Actions = {
	default: async ({ request, url }) => {
		const formData = await request.formData();
		const data = Object.fromEntries(formData);
		const parsed = schema.safeParse(data);

		if (!parsed.success) {
			return fail(400, {
				field: 'ucfEmail',
				error: parsed.error.issues[0].message,
				data
			});
		}

		const user = await prisma.user.findUnique({
			where: { ucfEmail: parsed.data.ucfEmail }
		});

		if (!user) {
			return { success: true };
		}

		const existing = await prisma.passwordResetToken.findUnique({ where: { userId: user.id } });

		if (existing) {
			if (existing.expiresAt > new Date()) {
				return { success: true };
			}
			await prisma.passwordResetToken.delete({ where: { id: existing.id } });
		}

		const token = randomBytes(32).toString('hex');
		const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

		await prisma.passwordResetToken.create({
			data: { token: hashResetToken(token), expiresAt, userId: user.id }
		});

		const resetLink = `${url.origin}/reset-password/${token}`;

		try {
			const client = getEmailClient();
			await client.sendEmailWithTemplate({
				From: 'RCCF-Web@rccf.club',
				To: parsed.data.ucfEmail,
				TemplateAlias: 'password-reset',
				TemplateModel: {
					product_name: 'RCCF',
					name: user.firstName,
					action_url: resetLink,
					company_name: 'Robotics Club of Central Florida',
					company_address: '3100 Technology Pkwy, Orlando, FL 32826'
				}
			});
		} catch (e) {
			console.error('[Email] Failed to send reset email:', e);
			return fail(500, { field: null, error: 'Failed to send reset email. Try again later.', data });
		}

		return { success: true };
	}
};
