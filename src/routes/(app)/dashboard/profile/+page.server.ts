import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { superValidate } from 'sveltekit-superforms/server';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/db';
let userID = '';
export const load = (async ({ parent }) => {
  const data = await parent();
  if (data.member && data.member?.lastName == undefined) {
    data.member.lastName == '';
  }
  userID = data.member!.id;
  //@ts-ignore
  const form = await superValidate(data.member, editProfileSchema);
  form.message = 'IDLE';
  return { user: data.member, form };
}) satisfies PageServerLoad;

const editProfileSchema = z.object({
  firstName: z.string(),
  lastName: z.string().optional(),
  discordProfileName: z.string(),
  email: z.string().email()
});
export const actions: Actions = {
  default: async ({ request }) => {
    const form = await superValidate(request, editProfileSchema);

    if (!form.valid) {
      // Again, return { form } and things will just work.
      form.message = 'NO';
      return fail(400, { form });
    }
    await db.member.update({
      where: { id: userID },
      data: {
        email: form.data.email,
        firstName: form.data.firstName,
        lastName: form.data.lastName ?? '',
        discordProfileName: form.data.discordProfileName
      }
    });
    form.message = 'OK';
    return { form };
  }
};
