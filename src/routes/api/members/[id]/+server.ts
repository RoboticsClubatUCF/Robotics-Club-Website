import { db } from '$lib/db';
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  if (!locals.member || locals.member.permissions.level < 10) {
    throw error(403, 'Forbidden');
  }

  const { id } = params;
  const body = await request.json();
  const { position, bio, profileLink } = body;

  const updated = await db.member.update({
    where: { id },
    data: {
      position: position || null,
      bio: bio || null,
      profileLink: profileLink || null
    },
    select: { id: true, position: true, bio: true, profileLink: true }
  });

  return json(updated);
};
