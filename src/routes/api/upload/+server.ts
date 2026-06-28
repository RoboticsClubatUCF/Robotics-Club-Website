import { error, json } from '@sveltejs/kit';
import { saveUpload, UploadError } from '$lib/server/assets';
import type { RequestHandler } from './$types';

// Generic image-upload endpoint. Writes the file to disk and returns its URL/key; the
// owning surface is responsible for persisting that reference (and the orphan sweep
// reclaims any file that never gets attached). Gated at a baseline editor level — the
// individual surfaces enforce their own stricter levels when they save the reference.
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.member || locals.member.permissions.level < 8) {
    throw error(403, 'Forbidden');
  }

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    throw error(400, 'No file provided.');
  }

  try {
    const { storageKey, mimeType, size } = await saveUpload(file);
    return json({ storageKey, url: `/uploads/${storageKey}`, mimeType, size });
  } catch (e) {
    if (e instanceof UploadError) throw error(e.status, e.message);
    throw e;
  }
};
