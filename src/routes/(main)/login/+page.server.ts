import { z } from 'zod';
import { superValidate } from 'sveltekit-superforms/server';
import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/db';
import { compare } from 'bcrypt';
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string()
});

export const load: PageServerLoad = async () => {
  const form = await superValidate(loginSchema);

  return { form };
};

export const actions: Actions = {
  default: async ({ request }) => {
    const form = await superValidate(request, loginSchema);
    if (!form.valid) {
      return fail(400, { form });
    }
    //check to make sure the password is good
    const reqUser = await db.member.findFirst({
      where: {
        email: form.data.email
      }
    });
    if (reqUser == null) {
      form.valid = false;
      form.message = 'user does not exist';
      return fail(400, { form });
    }
    const validPass = await compare(form.data.password, reqUser.passwordHash);

    throw redirect(302, '/dashboard');
  }
};
