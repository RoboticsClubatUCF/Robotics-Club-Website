import { z } from 'zod';
import { superValidate } from 'sveltekit-superforms/server';
import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
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

    // do something with the valid form, perhaps get the user data, assign a cookie and redirect to the dashboard

    throw redirect(302, '/dashboard');
  }
};
