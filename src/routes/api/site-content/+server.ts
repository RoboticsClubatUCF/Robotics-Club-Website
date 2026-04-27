import { db } from '$lib/db';
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
  const key = url.searchParams.get('key');

  if (key) {
    const content = await db.siteContent.findUnique({ where: { key } });
    return json({ value: content?.value ?? null });
  }

  const all = await db.siteContent.findMany();
  return json(all);
};

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.member || locals.member.permissions.level < 10) {
    throw error(403, 'Forbidden');
  }

  const body = await request.json();
  const { key, value, type } = body;

  if (!key || value === undefined || value === null) {
    throw error(400, 'Missing key or value');
  }

  const record = await db.siteContent.upsert({
    where: { key },
    create: { key, value, type: type ?? 'text', updatedBy: locals.member.email },
    update: { value, type: type ?? 'text', updatedBy: locals.member.email }
  });

  return json({ success: true, record });
};
