import { db } from '$lib/db';
import numProjects from '../../components/querytools/numbers/numProjects';
import type { PageServerLoad } from './$types';
import config from '../../config';

const CONTENT_KEYS = [
  'home.slogan',
  'home.missionStatement',
  'home.projectStatement',
  'home.teachingStatement',
  'home.competitionStatement',
  'home.outreachStatement',
  'home.researchStatement',
  'home.card.mission.image',
  'home.card.projects.image',
  'home.card.teaching.image',
  'home.card.competition.image',
  'home.card.outreach.image',
  'home.card.research.image',
  'home.section.team',
  'home.section.faq',
  'home.section.socials',
  'home.social.discord',
  'home.social.github',
  'home.social.instagram.club',
  'home.social.instagram.tapemeasure',
  'home.faq.items',
  'home.card.order',
  'home.officers.order'
];

const DEFAULT_CARD_ORDER = ['mission', 'projects', 'teaching', 'outreach', 'competition', 'research'];

export const load: PageServerLoad = async () => {
  const projectCount = await numProjects();

  const dbContent = await db.siteContent.findMany({
    where: { key: { in: CONTENT_KEYS } }
  });

  const contentMap: Record<string, string> = {};
  for (const row of dbContent) {
    contentMap[row.key] = row.value;
  }

  let faqItems: { question: string; answer: string }[] = [];
  try {
    if (contentMap['home.faq.items']) {
      faqItems = JSON.parse(contentMap['home.faq.items']);
    }
  } catch {
    faqItems = [];
  }

  const siteContent = {
    slogan: contentMap['home.slogan'] ?? config.information.slogan,
    missionStatement: contentMap['home.missionStatement'] ?? config.information.missionStatement,
    projectStatement: contentMap['home.projectStatement'] ?? config.information.projectStatement,
    teachingStatement: contentMap['home.teachingStatement'] ?? config.information.teachingStatement,
    competitionStatement:
      contentMap['home.competitionStatement'] ?? config.information.competitionStatement,
    outreachStatement: contentMap['home.outreachStatement'] ?? config.information.outreachStatement,
    researchStatement: contentMap['home.researchStatement'] ?? config.information.researchStatement,
    cardImages: {
      mission: contentMap['home.card.mission.image'] ?? '/photos/mission_statement.png',
      projects: contentMap['home.card.projects.image'] ?? '/photos/projects.png',
      teaching: contentMap['home.card.teaching.image'] ?? '/photos/teaching.png',
      competition: contentMap['home.card.competition.image'] ?? '/photos/competition.png',
      outreach: contentMap['home.card.outreach.image'] ?? '/photos/outreach.png',
      research: contentMap['home.card.research.image'] ?? '/photos/research.png'
    },
    sections: {
      team: contentMap['home.section.team'] ?? 'Meet the Team!',
      faq: contentMap['home.section.faq'] ?? 'Frequently Asked Questions!',
      socials: contentMap['home.section.socials'] ?? 'Check out our Socials!'
    },
    socials: {
      discord: contentMap['home.social.discord'] ?? 'https://discord.gg/m8XZahpNjR',
      github: contentMap['home.social.github'] ?? 'https://github.com/RoboticsClubatUCF',
      instagramClub:
        contentMap['home.social.instagram.club'] ?? 'https://www.instagram.com/ucf_robotics/',
      instagramTapemeasure:
        contentMap['home.social.instagram.tapemeasure'] ??
        'https://www.instagram.com/rccf.tapemeasure/'
    },
    faqItems
  };

  let cardOrder: string[];
  try {
    const parsed = contentMap['home.card.order'] ? JSON.parse(contentMap['home.card.order']) : null;
    cardOrder =
      Array.isArray(parsed) && parsed.length === DEFAULT_CARD_ORDER.length
        ? parsed
        : DEFAULT_CARD_ORDER;
  } catch {
    cardOrder = DEFAULT_CARD_ORDER;
  }

  const officers = await db.member.findMany({
    where: {
      roles: { some: { name: 'officer' } }
    },
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
  });

  let officerOrderIds: string[] = [];
  try {
    const parsed = contentMap['home.officers.order']
      ? JSON.parse(contentMap['home.officers.order'])
      : null;
    if (Array.isArray(parsed)) officerOrderIds = parsed;
  } catch {
    officerOrderIds = [];
  }

  if (officerOrderIds.length > 0) {
    officers.sort((a, b) => {
      const ai = officerOrderIds.indexOf(a.id);
      const bi = officerOrderIds.indexOf(b.id);
      return (ai === -1 ? 9999 : ai) - (bi === -1 ? 9999 : bi);
    });
  }

  return { projectCount, siteContent, officers, cardOrder };
};
