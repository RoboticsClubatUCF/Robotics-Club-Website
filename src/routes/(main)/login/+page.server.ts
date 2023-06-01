import { z } from 'zod';
import { superValidate } from 'sveltekit-superforms/server';
import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/db';
import { compare } from 'bcrypt';
import { randomUUID } from 'crypto';
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string()
});

export const load: PageServerLoad = async () => {
  const form = await superValidate(loginSchema);

  return { form };
};

export const actions: Actions = {
  default: async ({ request, cookies }) => {
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
      form.errors.email = ['user does not exist'];
      return fail(400, { form });
    }
    const validPass = await compare(form.data.password, reqUser.passwordHash);
    if (!validPass) {
      form.valid = false;
      form.errors.password = ['Password is incorrect'];
      return fail(400, { form });
    }
    //since the user is all good, and everything passes
    // we need to generate the session token and pass it to the user
    const sessionCookie = randomUUID();
    await db.member.update({
      where: {
        id: reqUser.id
      },
      data: {
        AuthToken: sessionCookie
      }
    });
    cookies.set('session', sessionCookie, {
      path: '/',
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 7
    });

    throw redirect(302, '/dashboard');
  }
};
