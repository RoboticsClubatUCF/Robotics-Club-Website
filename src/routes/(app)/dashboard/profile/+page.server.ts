import { z } from 'zod/v3';
import type { Actions, PageServerLoad } from './$types';
import { superValidate } from 'sveltekit-superforms';
import { zod } from '$lib/zodAdapter';
import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/db';
import { assignMemberRole } from '$lib/discord';

let userID = '';

export const load = (async ({ parent }) => {
  const data = await parent();
  if (data.member && data.member?.lastName == undefined) {
    data.member.lastName == '';
  }
  userID = data.member!.id;
  // @ts-ignore — data.member has extra Prisma fields not in editProfileSchema
  const form = await superValidate(data.member, zod(editProfileSchema));
  form.message = 'IDLE';
  return { user: data.member, form };
}) satisfies PageServerLoad;

const editProfileSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().optional(),
  discordProfileName: z.string().min(1, 'Discord username is required'),
  email: z.string().email('A valid email is required'),
  profilePictureUrl: z.string().optional().refine(
    (val) => !val || /^https?:\/\/.+/.test(val),
    { message: 'Must be a valid URL starting with http:// or https://' }
  )
});

export const actions: Actions = {
  updateProfile: async ({ request, fetch }) => {
    const form = await superValidate(request, zod(editProfileSchema));

    if (!form.valid) {
      form.message = 'NO';
      return fail(400, { form });
    }

    const current = await db.member.findUnique({
      where: { id: userID },
      select: { discordProfileName: true }
    });

    await db.member.update({
      where: { id: userID },
      data: {
        email: form.data.email,
        firstName: form.data.firstName,
        lastName: form.data.lastName ?? '',
        discordProfileName: form.data.discordProfileName,
        profilePictureUrl: form.data.profilePictureUrl || null
      }
    });

    const discordChanged = current?.discordProfileName !== form.data.discordProfileName;
    if (discordChanged) {
      const discord = await assignMemberRole(form.data.discordProfileName, fetch);
      if (!discord.success) {
        console.error('[Discord sync]', discord.error);
        form.message = 'OK_DISCORD_FAIL';
      } else {
        form.message = 'OK';
      }
    } else {
      form.message = 'OK';
    }

    return { form };
  },

  deleteAccount: async ({ request, cookies }) => {
    const data = await request.formData();
    const confirm1 = data.get('confirmName1') as string;
    const confirm2 = data.get('confirmName2') as string;

    const member = await db.member.findUnique({
      where: { id: userID },
      select: { firstName: true, lastName: true }
    });

    if (!member) return fail(404, { deleteError: 'Account not found.' });

    const fullName = [member.firstName, member.lastName].filter(Boolean).join(' ');

    if (confirm1 !== fullName || confirm2 !== fullName) {
      return fail(400, { deleteError: 'Names do not match. Please enter your full name exactly.' });
    }

    await db.$transaction([
      db.article.deleteMany({ where: { authorId: userID } }),
      db.blogPost.deleteMany({ where: { memberId: userID } }),
      db.member.delete({ where: { id: userID } })
    ]);

    cookies.set('session', '', { path: '/', expires: new Date(0) });
    throw redirect(302, '/');
  }
};
