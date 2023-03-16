import type { Actions } from './$types';
import { prisma } from '$lib/server/prisma';
import { fail } from '@sveltejs/kit';
import * as bcrypt from 'bcrypt';
const rounds = 12;
function hashPass(pass: string | Buffer) {
	let salt = bcrypt.genSaltSync(rounds);
	return bcrypt.hashSync(pass, salt);
}

export const actions: Actions = {
	createUser: async ({ request }) => {
		const { name_first, name_last, email, password } = Object.fromEntries(
			await request.formData()
		) as {
			name_first: string;
			name_last: string;
			email: string;
			password: string;
		};
		try {
			await prisma.member.create({
				data: {
					firstName: name_first,
					lastName: name_last,
					email: email,
					passwordHash: hashPass(password),
                    membershipExpDate:new Date()
				}
			});
		} catch (err) {
			console.error(err);
			return fail(500, { message: 'Could not create user.' });
		}
        return {status: 201}
	}
};
