import type { Actions, PageServerLoad } from './$types';
import { redirect, error } from '@sveltejs/kit';
import { db } from '$lib/db';

export type Sponsor = {
  name: string;
  imageUrl: string;
  link: string;
  tier: 'processor' | 'circuit' | 'bolt' | 'aluminum';
};

const TIER_KEYS = ['processor', 'circuit', 'bolt', 'aluminum'] as const;
const SPONSOR_KEY = 'sponsors.list';

const DEFAULT_TIERS = {
  processor: { name: 'Processor Patron', amount: '$5,000+' },
  circuit:   { name: 'Circuit Supporter', amount: 'up to $3,000' },
  bolt:      { name: 'Bolt Backer', amount: 'up to $1,000' },
  aluminum:  { name: 'Aluminum Ally', amount: '$250' }
};

async function readSponsors(): Promise<Sponsor[]> {
  const row = await db.siteContent.findUnique({ where: { key: SPONSOR_KEY } });
  if (!row?.value) return [];
  try { return JSON.parse(row.value); } catch { return []; }
}

async function writeSponsors(sponsors: Sponsor[]) {
  await db.siteContent.upsert({
    where: { key: SPONSOR_KEY },
    update: { value: JSON.stringify(sponsors) },
    create: { key: SPONSOR_KEY, value: JSON.stringify(sponsors), type: 'text' }
  });
}

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.member || locals.member.permissions.level < 10) {
    throw redirect(302, '/dashboard');
  }

  const sponsors = await readSponsors();

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
  ) as Record<(typeof TIER_KEYS)[number], { name: string; amount: string }>;

  return { sponsors, tiers };
};

export const actions: Actions = {
  create: async ({ request, locals }) => {
    if (locals.member.permissions.level < 10) throw error(403, 'Forbidden');
    const form = await request.formData();
    const name = (form.get('name') as string)?.trim();
    const imageUrl = (form.get('imageUrl') as string)?.trim() ?? '';
    const link = (form.get('link') as string)?.trim() ?? '';
    const tier = form.get('tier') as Sponsor['tier'];

    if (!name || !tier) return { error: 'Name and tier are required.' };

    const sponsors = await readSponsors();
    sponsors.push({ name, imageUrl, link, tier });
    await writeSponsors(sponsors);
  },

  update: async ({ request, locals }) => {
    if (locals.member.permissions.level < 10) throw error(403, 'Forbidden');
    const form = await request.formData();
    const index = parseInt(form.get('index') as string);
    const name = (form.get('name') as string)?.trim();
    const imageUrl = (form.get('imageUrl') as string)?.trim() ?? '';
    const link = (form.get('link') as string)?.trim() ?? '';
    const tier = form.get('tier') as Sponsor['tier'];

    if (!name || !tier) return { error: 'Name and tier are required.' };

    const sponsors = await readSponsors();
    if (index < 0 || index >= sponsors.length) return { error: 'Invalid sponsor.' };
    sponsors[index] = { name, imageUrl, link, tier };
    await writeSponsors(sponsors);
  },

  delete: async ({ request, locals }) => {
    if (locals.member.permissions.level < 10) throw error(403, 'Forbidden');
    const form = await request.formData();
    const index = parseInt(form.get('index') as string);

    const sponsors = await readSponsors();
    if (index < 0 || index >= sponsors.length) return { error: 'Invalid sponsor.' };
    sponsors.splice(index, 1);
    await writeSponsors(sponsors);
  }
};
