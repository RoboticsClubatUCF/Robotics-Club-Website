import { z } from 'zod/v3';
import type { Actions, PageServerLoad } from './$types';

export const load = (async () => {
  return {};
}) satisfies PageServerLoad;
const registerTeamsSchema = z.object({});

export const actions: Actions = {};
