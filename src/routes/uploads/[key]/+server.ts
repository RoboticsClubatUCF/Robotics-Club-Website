import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { mimeTypeForKey, uploadPath } from '$lib/server/assets';
import { isValidStorageKey } from '$lib/imageRef';
import type { RequestHandler } from './$types';

// Serves runtime-uploaded image files. (The build-time `static/` pipeline can't serve
// these — it's snapshotted at build and isn't on the persistent volume.)
export const GET: RequestHandler = async ({ params, setHeaders }) => {
  const key = params.key;
  if (!isValidStorageKey(key)) throw error(404, 'Not found');

  let data: Buffer;
  try {
    data = await readFile(uploadPath(key));
  } catch {
    throw error(404, 'Not found');
  }

  const isSvg = key.toLowerCase().endsWith('.svg');
  setHeaders({
    'Content-Type': mimeTypeForKey(key),
    'Content-Length': String(data.byteLength),
    // Storage keys are content-immutable (random UUID names), so cache aggressively.
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    // Harden direct navigation to an SVG document (rendering via <img> is already safe).
    ...(isSvg ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" } : {})
  });

  return new Response(new Uint8Array(data));
};
