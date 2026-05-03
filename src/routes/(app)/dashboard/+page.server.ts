import { db } from '$lib/db';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { Prisma } from '@prisma/client';
import semesterYear from '../../../components/scripts/semesterYear';
import config from '../../../config';
import { assignProjectRole } from '$lib/discord';

export type DashboardUser = Prisma.MemberGetPayload<{
  include: {
    Projects: { include: { logo: true } };
    Survey: true;
    role: true;
    roles: true;
  }
}>;

export const load: PageServerLoad = async ({ locals }) => {
  const dateInfo = semesterYear();

  const user = await db.member.findFirst({
    where: {
      email: locals.member.email
    },
    include: {
      Projects: {
        where: {
          year: dateInfo.year,
          season: dateInfo.semester
        },
        include: {
          logo: true
        }
      },
      Survey: true,
      role: true,
      roles: true
    }
  }) as DashboardUser | null;

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

  return { user, surveyDateUpdated, joinableProjects };
};

export const actions: Actions = {
  joinProject: async ({ request, locals, fetch }) => {
    if (!locals.member) return fail(401, { error: 'Not logged in' });

    const form = await request.formData();
    const projectId = Number(form.get('projectID'));
    if (!projectId) return fail(400, { error: 'Invalid project ID' });

    const self = await db.member.findFirst({
      where: { email: locals.member.email },
      select: { id: true, membershipExpDate: true, discordProfileName: true }
    });

    if (!self || self.membershipExpDate <= new Date()) {
      return fail(403, { error: 'Active membership required to join a project' });
    }

    const dateInfo = semesterYear();
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
      const august = new Date(currentYear, 7, 1);
      const dayOfWeek = august.getDay();
      const firstDayOfFourthWeek = 22 + (7 - dayOfWeek) % 7;

      await db.member.update({
        where: { id: id },
        data: {
          membershipExpDate: new Date(currentYear, 7, firstDayOfFourthWeek),
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
