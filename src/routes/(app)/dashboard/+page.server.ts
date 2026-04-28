import { db } from '$lib/db';
import type { Actions, PageServerLoad } from './$types';
import semesterYear from '../../../components/scripts/semesterYear';
import config from '../../../config';

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
      Teams: {
        include: {
          _count: {
            select: {
              members: true
            }
          }
        }
      },
      Survey: true,
      role: true,
      roles: true
    }
  });

  const surveyDateUpdated = user?.Survey?.DateUpdated;

  return { user, surveyDateUpdated };
};

export const actions: Actions = {
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
          }
        }
      });
    }
  }
};
