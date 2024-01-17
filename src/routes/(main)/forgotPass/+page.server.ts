import { db } from '$lib/db';
import { fail, redirect } from '@sveltejs/kit';
import { setError, superValidate } from 'sveltekit-superforms/server';
import { z } from 'zod';
import generatePassword from '../../../components/scripts/generatePass';
import type { Actions, PageServerLoad } from './[slug]/$types';

const forgotPasswordSchema = z.object({
  first: z.string(),
  email: z.string().email(),
  newPass: z.string().min(8, 'Password must be at least 8 characters long!')
});

export const load = (async ({ locals }) => {
  const form = await superValidate(forgotPasswordSchema);
  return { form };
}) satisfies PageServerLoad;

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const form = await superValidate(request, forgotPasswordSchema);
    const userInQuestion = await db.member.findFirst({
      where: {
        email: form.data.email
      }
    });
    if (!form.valid) {
      return fail(400, { form });
    }
    if (userInQuestion?.email.toLowerCase() != form.data.email.toLowerCase()) {
      return fail(400, { form });
    }
    if (userInQuestion.firstName.toLowerCase() != form.data.first.toLowerCase()) {
      return fail(400, { form });
    }
    // guess their credentials are good
    await db.member.update({
      where: {
        id: userInQuestion.id
      },
      data: {
        passwordHash: generatePassword(form.data.newPass)
      }
    });
    throw redirect(301, '/login');
  }
};
