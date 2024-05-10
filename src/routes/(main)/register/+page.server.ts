import { db } from '$lib/db';
import { fail, redirect } from '@sveltejs/kit';
import { randomUUID } from 'crypto';
import { setError, superValidate } from 'sveltekit-superforms/server';
import { z } from 'zod';
import generatePassword from '../../../components/scripts/generatePass';
import config from '../../../config';
import type { Actions, PageServerLoad } from './$types';

const registerSchema = z.object({
  email: z.string().email(),
  lname: z.string(),
  fname: z.string(),
  discord: z.string(),
  password: z.string().min(8, 'Password must be at least 8 characters long!'),
  confirmPassword: z.string()
});

export const load: PageServerLoad = async () => {
  const form = await superValidate(registerSchema);

  return { form };
};
export const actions: Actions = {
  default: async ({ request }) => {
    const form = await superValidate(request, registerSchema);
    if (!form.valid) {
      return fail(400, { form });
    }
    if (form.data.password != form.data.confirmPassword) {
      return setError(form, 'confirmPassword', 'Passwords do not match!');
    }
    if (
      (await db.member.findFirst({
        where: {
          email: form.data.email
        }
      })) != null
    ) {
      return setError(form, 'email', 'Email is already being used!');
    }
    if (
      (await db.member.findFirst({
        where: {
          discordProfileName: form.data.discord
        }
      })) != null
    ) {
      return setError(form, 'discord', 'Discord username is already being used!');
    }

    // generate the user token, and save the hashed password to the backend
    await db.member.create({
      data: {
        firstName: form.data.fname,
        lastName: form.data.lname,
        passwordHash: generatePassword(form.data.password),
        email: form.data.email,
        AuthToken: randomUUID(),
        discordProfileName: form.data.discord,
        role: {
          connectOrCreate: {
            where: {
              name: config.roles.guest.name
            },
            create: {
              name: config.roles.guest.name,
              permissionLevel: config.roles.guest.level
            }
          }
        }
      }
    });

    throw redirect(302, '/login');
  }
};
