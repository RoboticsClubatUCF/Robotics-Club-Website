import { db } from '$lib/db';
import { error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { Season } from '@prisma/client';
import { getCurrentSemester } from '$lib/currentSemester';
import { assignProjectRole, removeProjectRole } from '$lib/discord';

export const load: PageServerLoad = async ({ params, locals }) => {
  const dateInfo = await getCurrentSemester();

  const project = await db.project.findFirst({
    where: { id: Number(params.slug) },
    include: {
      extraLinks: true,
      members: {
        orderBy: { role: { permissionLevel: 'desc' } },
        include: { role: true }
      },
      articles: {
        orderBy: { createdAt: 'desc' },
        take: 3,
        include: { author: true, Tags: true, image: true }
      },
      Tags: true,
      teams: { include: { members: true } },
      logo: true
    }
  });

  if (project == null) throw error(404, 'Project not Found');

  const isCurrent =
    project.year === dateInfo.year && project.season === dateInfo.semester;

  let isJoined = false;
  let canJoin = false;

  if (locals.member) {
    const self = await db.member.findFirst({
      where: { email: locals.member.email },
      select: {
        id: true,
        membershipExpDate: true,
        surveyId: true,
        Projects: { select: { id: true } }
      }
    });
    if (self) {
      isJoined = self.Projects.some((p) => p.id === project.id);
      const duesActive = self.membershipExpDate > new Date();
      const isSummer = dateInfo.semester === Season.Summer;
      canJoin = !!self.surveyId && (isSummer || duesActive);
    }
  }

  return { project, isCurrent, isJoined, canJoin };
};

export const actions: Actions = {
  joinProject: async ({ params, locals, fetch }) => {
    if (!locals.member) return fail(401, { error: 'Not logged in' });

    const self = await db.member.findFirst({
      where: { email: locals.member.email },
      select: { id: true, membershipExpDate: true, surveyId: true, discordProfileName: true }
    });

    if (!self) return fail(404, { error: 'Member not found' });

    if (!self.surveyId) {
      return fail(403, { error: 'A completed member survey is required before joining a project' });
    }

    const dateInfo = await getCurrentSemester();
    const duesActive = self.membershipExpDate > new Date();

    if (dateInfo.semester !== Season.Summer && !duesActive) {
      return fail(403, { error: 'Active membership required to join a project' });
    }
    const project = await db.project.findFirst({
      where: { id: Number(params.slug) },
      select: { id: true, year: true, season: true, discordRoleId: true }
    });

    if (!project) return fail(404, { error: 'Project not found' });

    if (project.year !== dateInfo.year || project.season !== dateInfo.semester) {
      return fail(400, { error: 'You can only join projects from the current semester' });
    }

    await db.member.update({
      where: { id: self.id },
      data: { Projects: { connect: { id: project.id } } }
    });

    if (project.discordRoleId !== '1111111') {
      await assignProjectRole(self.discordProfileName, project.discordRoleId, fetch);
    }

    return { success: true, joined: true };
  },

  leaveProject: async ({ params, locals, fetch }) => {
    if (!locals.member) return fail(401, { error: 'Not logged in' });

    const self = await db.member.findFirst({
      where: { email: locals.member.email },
      select: { id: true, discordProfileName: true }
    });
    if (!self) return fail(404, { error: 'Member not found' });

    const project = await db.project.findFirst({
      where: { id: Number(params.slug) },
      select: { id: true, discordRoleId: true }
    });
    if (!project) return fail(404, { error: 'Project not found' });

    await db.member.update({
      where: { id: self.id },
      data: { Projects: { disconnect: { id: project.id } } }
    });

    if (project.discordRoleId !== '1111111') {
      await removeProjectRole(self.discordProfileName, project.discordRoleId, fetch);
    }

    return { success: true, joined: false };
  }
};
