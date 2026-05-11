import { db } from '$lib/db';
import type { PageServerLoad } from './$types';

const CONTENT_KEYS = [
  'about.pageTitle',
  'about.section.frq',
  'about.section.constitution',
  'about.section.taxInfo'
];

export const load: PageServerLoad = async () => {
  const [dbContent, officers] = await Promise.all([
    db.siteContent.findMany({ where: { key: { in: CONTENT_KEYS } } }),
    db.member.findMany({
      where: { role: { permissionLevel: { gte: 10, lt: 999 } } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        position: true,
        bio: true,
        profileLink: true,
        profilePictureUrl: true,
        role: { select: { name: true, permissionLevel: true } }
      },
      orderBy: { role: { permissionLevel: 'desc' } }
    })
  ]);

  const cm: Record<string, string> = {};
  for (const row of dbContent) cm[row.key] = row.value;

  return {
    officers,
    siteContent: {
      pageTitle: cm['about.pageTitle'] ?? 'Meet The Team!',
      frqSection: cm['about.section.frq'] ?? 'FAQ & What Do We Do!',
      constitutionSection: cm['about.section.constitution'] ?? 'Our Constitution',
      taxInfoSection: cm['about.section.taxInfo'] ?? 'Tax Info'
    }
  };
};
