import { db } from '$lib/db';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { superValidate } from 'sveltekit-superforms/server';
import semesterYear from '../../../components/scripts/semesterYear';
import config from '../../../config';

const updateDuesSchema = z.object({
  email: z.string().email(),
  duesType: z.number()
});

export const load: PageServerLoad = async ({ locals }) => {
  const form = await superValidate(updateDuesSchema);
  const dateInfo = semesterYear();

  const availableProjects = await db.project.findMany({
    where: {
      year: dateInfo.year,
      season: dateInfo.semester
    },
    include: {
      logo: true
    }
  });

  const user = await db.member.findFirst({
    where: {
      email: locals.member.email
    },
    include: {
      Projects: {
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
      Survey: true  // Include the survey information
    }
  });

  // Log the DateUpdated value from the user's survey
  const surveyDateUpdated = user?.Survey?.DateUpdated;
  // if (surveyDateUpdated) {
  //   console.log(`Survey Date Updated: ${surveyDateUpdated}`);
  // } else {
  //   console.log('Survey Date Updated not found');
  // }

  // Remove projects the user is already part of
  for (let i = 0; i < availableProjects.length; i++) {
    for (const element of user!.Projects) {
      if (availableProjects[i].id == element.id) {
        availableProjects.splice(i, 1);
      }
    }
  }

  return { user, form, availableProjects, surveyDateUpdated };
};

export const actions: Actions = {
  summerRole: async ({ request, locals }) => {
    const form = await request.formData();
    const id = form.get('id')?.toString();
    if (id) {
      const currentYear = new Date().getFullYear();
      const august = new Date(currentYear, 7, 1); // August 1st
      const dayOfWeek = august.getDay(); // Day of the week of August 1st
      const firstDayOfFourthWeek = 22 + (7 - dayOfWeek) % 7; // Calculate the first day of the fourth week of August

      await db.member.update({
        where: {
          id: id
        },
        data: {
          membershipExpDate: new Date(currentYear, 7, firstDayOfFourthWeek), // Set the calculated date
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
  },
  
  joinProject: async ({ request, locals }) => {
    const form = await request.formData();
    const id = Number(form.get('projectID'));

    await db.member.update({
      where: {
        email: locals.member.email
      },
      data: {
        Projects: {
          connect: {
            id: id
          }
        }
      }
    });
  }
};
