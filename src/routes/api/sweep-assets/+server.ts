import { error, json } from '@sveltejs/kit';
import { sweepOrphanedAssets } from '$lib/orphanedAssetSweep';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals }) => {
  if (!locals.member || locals.member.permissions.level < 10) {
    throw error(403, 'Forbidden');
  }
  const lines = await sweepOrphanedAssets();
  return json({ lines });
};
