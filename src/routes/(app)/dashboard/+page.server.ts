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
  }
};
