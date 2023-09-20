import { db } from '$lib/db';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { superValidate } from 'sveltekit-superforms/server';
import { fail } from '@sveltejs/kit';
import config from '../../../config';
import semesterYear from '../../../components/scripts/semesterYear';

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
      }
    }
  });

  for (let i = 0; i < availableProjects.length; i++) {
    for (let j = 0; j < user!.Projects.length; j++) {
      if (availableProjects[i].id == user!.Projects[j].id) {
        availableProjects.splice(i, 1);
      }
    }
  }
  return { user, form, availableProjects };
};

const updateDuesSchema = z.object({
  email: z.string().email(),
  duesType: z.number()
});
export const actions: Actions = {
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
  },
  dues: async ({ request }) => {
    const form = await superValidate(request, updateDuesSchema);
    if (!form.valid) {
      return fail(400, { form });
    }
    // in case users have already paid, no point in hust resetting their dues

    const user = await db.member.findFirst({
      where: {
        email: form.data.email
      }
    });

    const something = await db.member.update({
      where: {
        email: form.data.email
      },
      data: {
        membershipExpDate: calculateValidSemester(user?.membershipExpDate),
        role: {
          connectOrCreate: {
            where: {
              name: config.roles.member.name
            },
            create: {
              name: config.roles.member.name,
              permissionLevel: config.roles.member.level
            }
          }
        }
      }
    });
    console.log(form.data.duesType);
    function calculateValidSemester(currentEndDate: Date | undefined) {
      // slowly increment until the valid next due date is calculated
      let isValidSemester = false;
      let startingDate: Date = new Date();
      if ((currentEndDate?.getTime() ?? 0 > new Date().getTime()) && currentEndDate != undefined) {
        startingDate = currentEndDate;
      }
      let currentYear = new Date().getFullYear();
      // This is to calculate when their dues should end, should they pay for the semester option
      if (form.data.duesType == 1) {
        // This is the first time the user is paying, so we simply look for the next bracket, and put them in there!
        if (new Date().getMonth() < 4) {
          return new Date(currentYear, 4, 5).toISOString();
        } else {
          return new Date(currentYear + 1, 0, 1).toISOString();
        }
      } else if (form.data.duesType == 2) {
        //  THis is for if a user buys dues for a year
        return new Date(new Date().setFullYear(2024)).toISOString();
      }
    }
  }
};
