import { db } from '$lib/db';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load = (async ({ params }) => {
  const project = await db.project.findFirst({
    where: {
      id: Number(params.slug)
    }
  });
  if (project == null) {
    throw error(404, 'Project not Found');
  }
  return { project };
}) satisfies PageServerLoad;
