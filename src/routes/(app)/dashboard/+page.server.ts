import { db } from '$lib/db';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { superValidate } from 'sveltekit-superforms/server';
import { fail } from '@sveltejs/kit';
import config from '../../../config';

export const load: PageServerLoad = async ({ locals }) => {
  const form = await superValidate(updateDuesSchema);
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
  return { user, form };
};

const updateDuesSchema = z.object({
  email: z.string().email(),
  duesType: z.number()
});
export const actions: Actions = {
  default: async ({ request }) => {
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
        membershipExpDate: calculateValidSemester(user?.membershipExpDate)
      }
    });
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
