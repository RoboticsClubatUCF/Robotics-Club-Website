import type { Actions, PageServerLoad } from './$types';
import { redirect, error } from '@sveltejs/kit';
import { db } from '$lib/db';

const TIER_KEYS = ['processor', 'circuit', 'bolt', 'aluminum'] as const;
type TierKey = (typeof TIER_KEYS)[number];

const DEFAULT_TIERS = {
  processor: { name: 'Processor Patron', amount: '$5,000+' },
  circuit:   { name: 'Circuit Supporter', amount: 'up to $3,000' },
  bolt:      { name: 'Bolt Backer', amount: 'up to $1,000' },
  aluminum:  { name: 'Aluminum Ally', amount: '$250' }
};

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.member || locals.member.permissions.level < 10) {
    throw redirect(302, '/dashboard');
  }

  const sponsors = await db.webSponsor.findMany({ orderBy: { id: 'asc' } });

  const contentKeys = TIER_KEYS.flatMap((k) => [
    `sponsors.tier.${k}.name`,
    `sponsors.tier.${k}.amount`
  ]);
  const rows = await db.siteContent.findMany({ where: { key: { in: contentKeys } } });
  const cm: Record<string, string> = {};
  for (const row of rows) cm[row.key] = row.value;

  const tiers = Object.fromEntries(
    TIER_KEYS.map((k) => [
      k,
      {
        name: cm[`sponsors.tier.${k}.name`] ?? DEFAULT_TIERS[k].name,
        amount: cm[`sponsors.tier.${k}.amount`] ?? DEFAULT_TIERS[k].amount
      }
    ])
  ) as Record<TierKey, { name: string; amount: string }>;

  return { sponsors, tiers };
};

export const actions: Actions = {
  create: async ({ request, locals }) => {
    if (locals.member.permissions.level < 10) throw error(403, 'Forbidden');
    const form = await request.formData();
    const name = (form.get('name') as string)?.trim();
    const imageUrl = (form.get('imageUrl') as string)?.trim() ?? '';
    const link = (form.get('link') as string)?.trim() ?? '';
    const tier = form.get('tier') as string;

    if (!name || !tier) return { error: 'Name and tier are required.' };
    if (imageUrl && !imageUrl.startsWith('https://')) return { error: 'Image URL must start with https://' };
    if (link && !link.startsWith('https://')) return { error: 'Website link must start with https://' };

    await db.webSponsor.create({ data: { name, imageUrl, link, tier } });
  },

  update: async ({ request, locals }) => {
    if (locals.member.permissions.level < 10) throw error(403, 'Forbidden');
    const form = await request.formData();
    const id = parseInt(form.get('id') as string);
    const name = (form.get('name') as string)?.trim();
    const imageUrl = (form.get('imageUrl') as string)?.trim() ?? '';
    const link = (form.get('link') as string)?.trim() ?? '';
    const tier = form.get('tier') as string;

    if (!name || !tier || isNaN(id)) return { error: 'Name and tier are required.' };
    if (imageUrl && !imageUrl.startsWith('https://')) return { error: 'Image URL must start with https://' };
    if (link && !link.startsWith('https://')) return { error: 'Website link must start with https://' };

    await db.webSponsor.update({ where: { id }, data: { name, imageUrl, link, tier } });
  },

  delete: async ({ request, locals }) => {
    if (locals.member.permissions.level < 10) throw error(403, 'Forbidden');
    const form = await request.formData();
    const id = parseInt(form.get('id') as string);

    if (isNaN(id)) return { error: 'Invalid sponsor.' };
    await db.webSponsor.delete({ where: { id } });
  }
};
