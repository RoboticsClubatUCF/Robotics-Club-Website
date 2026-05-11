import { db } from '$lib/db';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { type Prisma, Season } from '@prisma/client';
import { getCurrentSemester, isInGracePeriod } from '$lib/currentSemester';
import config from '../../../config';
import { assignProjectRole, removeProjectRole } from '$lib/discord';
import { getSemesterEndDate, getSemesterStartDate } from '$lib/ucfCalendar';

export type DashboardUser = Prisma.MemberGetPayload<{
  include: {
    Projects: { include: { logo: true } };
    Survey: true;
    role: true;
    roles: true;
  }
}>;

export const load: PageServerLoad = async ({ locals, fetch }) => {
  const today = new Date();
  const year = today.getFullYear();

  const [dateInfo, springEnd, fallStart] = await Promise.all([
    getCurrentSemester(),
    getSemesterEndDate(year, 'spring'),
    getSemesterStartDate(year, 'fall')
  ]);

  const isSummerPeriod = today >= springEnd && today < fallStart;
  const inGracePeriod = await isInGracePeriod(dateInfo.semester, dateInfo.year);
  const isSummer = dateInfo.semester === Season.Summer;

  const memberQuery = {
    where: { email: locals.member.email },
    include: {
      Projects: {
        where: { year: dateInfo.year, season: dateInfo.semester },
        include: { logo: true }
      },
      Survey: true,
      role: true,
      roles: true
    }
  };

  let user = await db.member.findFirst(memberQuery) as DashboardUser | null;

  // After the grace period ends, expired members lose their current-semester project
  // memberships and are reset to guest role so the DB stays consistent.
  if (user && !isSummer && !inGracePeriod && user.membershipExpDate <= today) {
    let didCleanup = false;

    if (user.Projects.length > 0) {
      for (const project of user.Projects) {
        if (project.discordRoleId !== '1111111') {
          removeProjectRole(user.discordProfileName, project.discordRoleId, fetch).catch(() => {});
        }
      }
      await db.member.update({
        where: { id: user.id },
        data: { Projects: { disconnect: user.Projects.map((p) => ({ id: p.id })) } }
      });
      didCleanup = true;
    }

    if (user.role.permissionLevel <= config.roles.member.level && user.role.name !== config.roles.guest.name) {
      await db.member.update({
        where: { id: user.id },
        data: {
          role: {
            connectOrCreate: {
              where: { name: config.roles.guest.name },
              create: { permissionLevel: config.roles.guest.level, name: config.roles.guest.name }
            }
          },
          roles: {
            disconnect: user.roles
              .filter((r) => r.permissionLevel <= config.roles.member.level)
              .map((r) => ({ id: r.id }))
          }
        }
      });
      didCleanup = true;
    }

    if (didCleanup) {
      user = await db.member.findFirst(memberQuery) as DashboardUser | null;
    }
  }

  const surveyDateUpdated = user?.Survey?.DateUpdated;
  const userProjectIds = user?.Projects.map((p) => p.id) ?? [];

  const joinableProjects = await db.project.findMany({
    where: {
      year: dateInfo.year,
      season: dateInfo.semester,
      id: { notIn: userProjectIds }
    },
    include: { logo: true }
  });

  return {
    user,
    surveyDateUpdated,
    joinableProjects,
    isSummerPeriod,
    inGracePeriod,
    currentYear: dateInfo.year,
    currentSemester: dateInfo.semester
  };
};

export const actions: Actions = {
  joinProject: async ({ request, locals, fetch }) => {
    if (!locals.member) return fail(401, { error: 'Not logged in' });

    const form = await request.formData();
    const projectId = Number(form.get('projectID'));
    if (!projectId) return fail(400, { error: 'Invalid project ID' });

    const self = await db.member.findFirst({
      where: { email: locals.member.email },
      select: { id: true, membershipExpDate: true, surveyId: true, discordProfileName: true }
    });

    if (!self) return fail(404, { error: 'Member not found' });

    if (!self.surveyId) {
      return fail(403, { error: 'A completed member survey is required before joining a project' });
    }

    const dateInfo = await getCurrentSemester();
    const inGracePeriod = await isInGracePeriod(dateInfo.semester, dateInfo.year);
    const duesActive = self.membershipExpDate > new Date();

    if (dateInfo.semester !== Season.Summer && !inGracePeriod && !duesActive) {
      return fail(403, { error: 'Active membership required to join a project' });
    }

    const project = await db.project.findFirst({
      where: { id: projectId },
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

    return { success: true };
  },

  summerRole: async ({ request, locals }) => {
    const form = await request.formData();
    const id = form.get('id')?.toString();
    if (id) {
      const self = await db.member.findFirst({ where: { email: locals.member.email }, select: { id: true } });
      if (self?.id !== id) return;
      const currentYear = new Date().getFullYear();

      await db.member.update({
        where: { id: id },
        data: {
          membershipExpDate: await getSemesterEndDate(currentYear, 'summer'),
          role: {
            connectOrCreate: {
              create: {
                permissionLevel: config.roles.member.level,
                name: config.roles.member.name
              },
              where: {
                name: config.roles.member.name
              }
            }
          },
          roles: {
            connectOrCreate: {
              create: {
                permissionLevel: config.roles.member.level,
                name: config.roles.member.name
              },
              where: {
                name: config.roles.member.name
              }
            }
          }
        }
      });
    }
  }
};
