import { db } from '$lib/db';
import type { PageServerLoad } from './$types';

export type Sponsor = {
  name: string;
  imageUrl: string;
  link: string;
  tier: 'processor' | 'circuit' | 'bolt' | 'aluminum';
};

type TierInfo = {
  name: string;
  amount: string;
  benefits: string[];
};

const DEFAULT_SPONSORS: Sponsor[] = [
  {
    name: 'Go Engineer',
    imageUrl:
      'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQcI8iitb1xCWitrAjcMgtqmkQrGi0aAY9xpf48RKL-O_1GzCPqo5zEkzoOz6CB-GI3wA4&usqp=CAU',
    link: 'https://www.goengineer.com/',
    tier: 'processor'
  },
  {
    name: 'Retengax',
    imageUrl:
      'https://lh3.googleusercontent.com/pw/AP1GczOGcEn1Ztbwkhrfkyb6yuhgUvByGfARYW5qJo1iBRDfefpX-fUJWo4DDATe0fBL_UhrGpDTHt72Hg9rUZntqHPWG44bAaOkBBQLNuGnUw-VEtkC0IrizoG_3QHCTrrIcsaR8RJ53w3UoW7PsYvZwO16=w192-h192-s-no-gm?authuser=0',
    link: 'https://www.retengax.com.br/',
    tier: 'processor'
  },
  {
    name: 'Orlando Recycles',
    imageUrl:
      'https://static.wixstatic.com/media/7cdbae_45341b034ab7454fa06333ed8df1fbf8~mv2.png',
    link: 'https://www.orlandorecycles.com/',
    tier: 'circuit'
  },
  {
    name: 'Protocase',
    imageUrl:
      'https://lh3.googleusercontent.com/pw/AP1GczP4LH7ppxLX_QYV_ciUL4052712OmUTUlrC83gwEWenPesQSV5QxB9g94t-4i4wKz9dY7vLJD6zQ9EZ3cW_am3cF70UWLEWWtzOnBSzmksyW8a_m8y8JQaxXR9BTmNUEOLb9LkdnPouzm12eDbQpK-h=w131-h133-s-no-gm?authuser=0',
    link: 'https://www.protocase.com/',
    tier: 'circuit'
  },
  {
    name: 'UCF CECS',
    imageUrl:
      'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRwvvA5u034vT8SJmEZwe6QS17C5qTCZqmYqA&s',
    link: 'https://www.cecs.ucf.edu/',
    tier: 'circuit'
  },
  {
    name: 'RedBull',
    imageUrl:
      'https://cdn.brandfetch.io/iddByYpFsc/w/400/h/400/theme/dark/icon.png?c=1bxid64Mup7aczewSAYMX&t=1667560742112',
    link: 'https://www.redbull.com/us-en',
    tier: 'bolt'
  },
  {
    name: 'SendCutSend',
    imageUrl: 'https://www.svgrepo.com/show/331572/sendcutsend.svg',
    link: 'https://sendcutsend.com/',
    tier: 'bolt'
  },
  {
    name: 'GoBilda',
    imageUrl:
      'https://lh3.googleusercontent.com/pw/AP1GczMtxPR3SMWXkulENPr2NDN-K328CRuYgLIb7PJDBw748kpAIAWpdPFpwd3VlaDKhde5UaRD9WdvFxhzPHl2fxaOewwHXYchMc_4qpkjx7rvVWrGy6FjoPCs5upzqlS-13memuceAnk-JU75v_43NDJssYH=w900-h900-s-no-gm?authuser=0',
    link: 'https://www.gobilda.com/',
    tier: 'aluminum'
  }
];

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
  'sponsors.list',
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
  const dbContent = await db.siteContent.findMany({ where: { key: { in: CONTENT_KEYS } } });
  const cm: Record<string, string> = {};
  for (const row of dbContent) cm[row.key] = row.value;

  let sponsors: Sponsor[] = DEFAULT_SPONSORS;
  try {
    if (cm['sponsors.list']) sponsors = JSON.parse(cm['sponsors.list']);
  } catch { /* use default */ }

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
