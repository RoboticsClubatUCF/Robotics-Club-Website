import { z } from 'zod/v3';
import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load = (async ({ locals }) => {
  if (locals.member.permissions.level < 4) {
    throw redirect(302, '/dashboard');
  }
  return {};
}) satisfies PageServerLoad;
const registerTeamsSchema = z.object({});

export const actions: Actions = {};
