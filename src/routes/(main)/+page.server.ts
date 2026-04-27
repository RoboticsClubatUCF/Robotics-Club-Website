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
  'home.card.research.image'
];

export const load: PageServerLoad = async () => {
  const projectCount = await numProjects();

  const dbContent = await db.siteContent.findMany({
    where: { key: { in: CONTENT_KEYS } }
  });

  const contentMap: Record<string, string> = {};
  for (const row of dbContent) {
    contentMap[row.key] = row.value;
  }

  const siteContent = {
    slogan: contentMap['home.slogan'] ?? config.information.slogan,
    missionStatement: contentMap['home.missionStatement'] ?? config.information.missionStatement,
    projectStatement: contentMap['home.projectStatement'] ?? config.information.projectStatement,
    teachingStatement: contentMap['home.teachingStatement'] ?? config.information.teachingStatement,
    competitionStatement: contentMap['home.competitionStatement'] ?? config.information.competitionStatement,
    outreachStatement: contentMap['home.outreachStatement'] ?? config.information.outreachStatement,
    researchStatement: contentMap['home.researchStatement'] ?? config.information.researchStatement,
    cardImages: {
      mission: contentMap['home.card.mission.image'] ?? '/photos/mission_statement.png',
      projects: contentMap['home.card.projects.image'] ?? '/photos/projects.png',
      teaching: contentMap['home.card.teaching.image'] ?? '/photos/teaching.png',
      competition: contentMap['home.card.competition.image'] ?? '/photos/competition.png',
      outreach: contentMap['home.card.outreach.image'] ?? '/photos/outreach.png',
      research: contentMap['home.card.research.image'] ?? '/photos/research.png'
    }
  };

  const officers = await db.member.findMany({
    where: {
      role: { permissionLevel: { gte: 10 } }
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      position: true,
      bio: true,
      profileLink: true,
      role: { select: { name: true, permissionLevel: true } }
    },
    orderBy: { role: { permissionLevel: 'desc' } }
  });

  return { projectCount, siteContent, officers };
};
