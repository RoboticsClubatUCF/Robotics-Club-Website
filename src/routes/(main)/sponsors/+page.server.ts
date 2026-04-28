import { db } from '$lib/db';
import type { PageServerLoad } from './$types';

export type Sponsor = {
  id: number;
  name: string;
  imageUrl: string;
  link: string;
  tier: string;
};

type TierInfo = {
  name: string;
  amount: string;
  benefits: string[];
};


const DEFAULT_TIERS: Record<string, TierInfo> = {
  processor: {
    name: 'PROCESSOR PATRON',
    amount: '$5,000+',
    benefits: [
      'Acknowledgments in social media posts',
      'Logo on club promotional materials for community events',
      '+ Circuit Supporter'
    ]
  },
  circuit: {
    name: 'CIRCUIT SUPPORTER',
    amount: 'UP TO $3,000',
    benefits: ['Logo on club T-shirts *', 'Logo on multiple robots/projects of choice', '+ Bolt Backer']
  },
  bolt: {
    name: 'BOLT BACKER',
    amount: 'UP TO $1,000',
    benefits: ['Logo on single robot/project of choice **', '+ Aluminum Ally']
  },
  aluminum: {
    name: 'ALUMINUM ALLY',
    amount: '$250',
    benefits: [
      'Appearance on club website sponsors page',
      'Logo/Infographic in club workspace *',
      'Member made sponsorship gift'
    ]
  }
};

const CONTENT_KEYS = [
  'sponsors.scroller.title',
  'sponsors.tiers.title',
  'sponsors.tier.processor.name',
  'sponsors.tier.processor.amount',
  'sponsors.tier.processor.benefits',
  'sponsors.tier.circuit.name',
  'sponsors.tier.circuit.amount',
  'sponsors.tier.circuit.benefits',
  'sponsors.tier.bolt.name',
  'sponsors.tier.bolt.amount',
  'sponsors.tier.bolt.benefits',
  'sponsors.tier.aluminum.name',
  'sponsors.tier.aluminum.amount',
  'sponsors.tier.aluminum.benefits',
  'sponsors.notes',
  'sponsors.contact.email'
];

function parseTier(cm: Record<string, string>, key: string): TierInfo {
  const def = DEFAULT_TIERS[key];
  let benefits = def.benefits;
  try {
    if (cm[`sponsors.tier.${key}.benefits`]) {
      benefits = JSON.parse(cm[`sponsors.tier.${key}.benefits`]);
    }
  } catch { /* use default */ }
  return {
    name: cm[`sponsors.tier.${key}.name`] ?? def.name,
    amount: cm[`sponsors.tier.${key}.amount`] ?? def.amount,
    benefits
  };
}

export const load: PageServerLoad = async () => {
  const [dbContent, sponsors] = await Promise.all([
    db.siteContent.findMany({ where: { key: { in: CONTENT_KEYS } } }),
    db.webSponsor.findMany({ orderBy: { id: 'asc' } })
  ]);
  const cm: Record<string, string> = {};
  for (const row of dbContent) cm[row.key] = row.value;

  return {
    sponsors,
    siteContent: {
      scrollerTitle: cm['sponsors.scroller.title'] ?? 'TOP SPONSORS',
      tiersTitle: cm['sponsors.tiers.title'] ?? 'SPONSORSHIP TIERS',
      notes:
        cm['sponsors.notes'] ??
        '* Logo size determined by donation amount\n** Robot(s)/project(s) must be selected at the time of donation\nNOTE: Your sponsorship is tax-deductible and we\'ll provide a receipt for your records.',
      contactEmail: cm['sponsors.contact.email'] ?? 'outreach@rccf.club',
      tiers: {
        processor: parseTier(cm, 'processor'),
        circuit: parseTier(cm, 'circuit'),
        bolt: parseTier(cm, 'bolt'),
        aluminum: parseTier(cm, 'aluminum')
      }
    }
  };
};
