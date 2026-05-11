import { db } from '$lib/db';
import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const MSG_KEY = 'acknowledgementMessage';

export const load: PageServerLoad = async ({ locals }) => {
  const [member, content] = await Promise.all([
    db.member.findFirst({
      where: { email: locals.member.email },
      select: { id: true, membershipExpDate: true }
    }),
    db.siteContent.findUnique({ where: { key: MSG_KEY } })
  ]);

  if (!member) throw error(404);

  const membershipExpired = member.membershipExpDate < new Date();
  const isAdmin = locals.member.permissions.level >= 999;
  // Expired officers lose officer privileges here — they see the payment prompt
  // like any other expired member. Only active officers (and admins) can edit
  // the message.
  const isOfficer = isAdmin || (locals.member.permissions.level >= 10 && !membershipExpired);

  // Non-officers with active dues have nothing to do here
  if (!membershipExpired && !isOfficer) {
    throw redirect(302, '/dashboard');
  }

  return {
    message: content?.value ?? '<Insert acknowledgement message>',
    memberId: member.id,
    membershipExpired,
    isOfficer
  };
};

export const actions: Actions = {
  confirm: async ({ locals }) => {
    await db.member.update({
      where: { email: locals.member.email },
      data: { acknowledgedAt: new Date() }
    });
    return { confirmed: true };
  },

  update: async ({ request, locals }) => {
    if (locals.member.permissions.level < 10) throw error(403, 'Forbidden');

    // Non-admin officers must have active dues to edit the message.
    if (locals.member.permissions.level < 999) {
      const self = await db.member.findFirst({
        where: { email: locals.member.email },
        select: { membershipExpDate: true }
      });
      if (!self || self.membershipExpDate < new Date()) throw error(403, 'Active membership required');
    }

    const form = await request.formData();
    const message = (form.get('message') as string)?.trim();

    if (!message) return { error: 'Message cannot be empty.' };

    await db.siteContent.upsert({
      where: { key: MSG_KEY },
      update: { value: message, updatedBy: locals.member.email },
      create: { key: MSG_KEY, value: message, type: 'text', updatedBy: locals.member.email }
    });

    return { success: true };
  }
};
