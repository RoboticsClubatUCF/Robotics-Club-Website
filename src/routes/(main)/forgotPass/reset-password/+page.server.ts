import { db } from '$lib/db';
import { fail, redirect } from '@sveltejs/kit';
import { superValidate, setError } from 'sveltekit-superforms/server';
import { z } from 'zod';
import generatePassword from '../../../../components/scripts/generatePass';
import type { Actions, PageServerLoad } from './$types';

const resetPasswordSchema = z.object({
  token: z.string(),
  newPassword: z.string().min(8, 'Password must be at least 8 characters long!'),
  confirmPass: z.string()
}).refine(data => data.newPassword === data.confirmPass, {
  message: "Passwords don't match!",
  path: ['confirmPass']
});

export const load = (async ({ url }) => {
  const token = url.searchParams.get('token');
  if (!token) {
    throw redirect(301, '/'); // Redirect if no token is provided
  }

  const tokenRecord = await db.passwordResetToken.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!tokenRecord || tokenRecord.expiresAt < new Date()) {
    throw redirect(301, '/'); // Redirect if the token is invalid or expired
  }

  const form = await superValidate({ token }, resetPasswordSchema);
  return { form };
}) satisfies PageServerLoad;

export const actions: Actions = {
  default: async ({ request }) => {
    const form = await superValidate(request, resetPasswordSchema);
    if (!form.valid) {
      return fail(400, { form });
    }

    const tokenRecord = await db.passwordResetToken.findUnique({
      where: { token: form.data.token },
      include: { user: true },
    });

    if (!tokenRecord || tokenRecord.expiresAt < new Date()) {
      return fail(400, { form, error: 'Invalid or expired token.' });
    }

    // Update the user's password
    await db.member.update({
      where: { id: tokenRecord.userId },
      data: { passwordHash: generatePassword(form.data.newPassword) },
    });

    // Delete the token after use
    await db.passwordResetToken.delete({
      where: { token: form.data.token },
    });

    throw redirect(301, '/login');
  }
};
