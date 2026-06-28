import { db } from '$lib/db';
import { json, error } from '@sveltejs/kit';
import { keyFromSrc } from '$lib/imageRef';
import { safeDeletePhysical } from '$lib/server/assets';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  if (!locals.member || locals.member.permissions.level < 10) {
    throw error(403, 'Forbidden');
  }

  const { id } = params;
  const body = await request.json();
  const { position, bio, profileLink, profilePictureUrl } = body;

  const prev = await db.member.findUnique({ where: { id }, select: { profilePictureUrl: true } });
  const newPicture = profilePictureUrl || null;

  const updated = await db.member.update({
    where: { id },
    data: {
      position: position || null,
      bio: bio || null,
      profileLink: profileLink || null,
      profilePictureUrl: newPicture
    },
    select: { id: true, position: true, bio: true, profileLink: true, profilePictureUrl: true }
  });

  const oldKey = keyFromSrc(prev?.profilePictureUrl);
  if (oldKey && oldKey !== keyFromSrc(newPicture)) await safeDeletePhysical(oldKey);

  return json(updated);
};
