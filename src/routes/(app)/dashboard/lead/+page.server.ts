import { redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { z } from 'zod/v3';
import { superValidate } from 'sveltekit-superforms';
import { zod } from '$lib/zodAdapter';

export const load = (async ({ locals }) => {
  const form = await superValidate(zod(blogpostSchema));
  if (locals.member.permissions.level < 8) {
    throw redirect(302, '/dashboard');
  }
  return { form };
}) satisfies PageServerLoad;

const blogpostSchema = z.object({
  title: z.string().max(32, 'Titles cannot be more than 32 characters!'),
  blogpost: z.string(),
  picture: z.string() // string that represents the url of the picture
});
export const actions: Actions = {
  blogPost: async ({ locals, request }) => {
    const form = await superValidate(request, zod(blogpostSchema));
  }
};
