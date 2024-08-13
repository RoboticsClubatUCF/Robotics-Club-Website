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

  // console.log('Token from URL:', token); // Print the token from the URL

  const tokenRecord = await db.passwordResetToken.findUnique({
    where: { token },
    include: { user: true },
  });

  // if (!tokenRecord) {
  //   console.log('No matching token found in the database.');
  // } else {
  //   console.log('Token found in database:', tokenRecord.token);
  //   console.log('Token expiration time:', tokenRecord.expiresAt);
  // }

  if (!tokenRecord || tokenRecord.expiresAt < new Date()) {
    return fail(400, { form: null, error: 'Invalid or expired token.' });
  }

  const form = await superValidate({ token }, resetPasswordSchema);
  return { form };
}) satisfies PageServerLoad;

export const actions: Actions = {
  default: async ({ request }) => {
    const form = await superValidate(request, resetPasswordSchema);
    
    if (!form.valid) {
      // console.log('Form validation failed:', form.errors);
      return fail(400, { form });
    }

    // console.log('Token submitted with form:', form.data.token);

    const tokenRecord = await db.passwordResetToken.findUnique({
      where: { token: form.data.token },
      include: { user: true },
    });

    if (!tokenRecord) {
      // console.log('No matching token found in the database during form submission.');
      return fail(400, { form, error: 'Invalid or expired token.' });
    }

    if (tokenRecord.expiresAt < new Date()) {
      // console.log('Token is expired.');
      return fail(400, { form, error: 'Invalid or expired token.' });
    }

    // console.log('Token is valid, updating password for user ID:', tokenRecord.userId);

    // Update the user's password
    await db.member.update({
      where: { id: tokenRecord.userId },
      data: { passwordHash: generatePassword(form.data.newPassword) },
    });

    // Delete the token after use
    await db.passwordResetToken.delete({
      where: { token: form.data.token },
    });

    // console.log('Password updated and token deleted. Redirecting to login.');
    throw redirect(301, '/login');
  }
};

