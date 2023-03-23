import type { Actions } from './$types';
import { prisma } from '$lib/server/prisma';
import { fail } from '@sveltejs/kit';
import * as bcrypt from 'bcrypt';

function comparePass(pass: string | Buffer, hash: string | undefined) {
	if (hash === undefined) {
		return new Error('Password not provided');
	}
	return bcrypt.compareSync(pass, hash);
}

export const actions: Actions = {
	loginUser: async ({ request }) => {
		const { email, password } = Object.fromEntries(await request.formData()) as {
			email: string;
			password: string;
		};
		try {
			const user = await prisma.member.findUnique({
				where: {
					email: email
				}
			});
			if (comparePass(password, user?.passwordHash)) {
				return { status: 201 };
			} else {
				throw new Error('Password Incorrect');
			}
		} catch (err) {
			console.error(err);
			return fail(500, { message: 'username or password is incorrect' });
		}
	}
};
