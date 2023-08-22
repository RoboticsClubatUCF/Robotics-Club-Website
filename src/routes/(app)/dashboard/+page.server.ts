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
    }
  });
  const projects = await db.project.findMany({});
  return { user, projects, form };
};

const updateDuesSchema = z.object({
  email: z.string().email()
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
    console.log(something);

    function calculateValidSemester(currentEndDate: Date | undefined) {
      // slowly increment until the valid next due date is calculated
      let isValidSemester = false;
      let startingDate: Date = new Date();
      if ((currentEndDate?.getTime() ?? 0 > new Date().getTime()) && currentEndDate != undefined) {
        startingDate = currentEndDate;
      }
      let currentYear = new Date().getFullYear();
      /**
       * to calculate this,
       *  the user submitted the form so 2 cases occur
       *    The user is paying for the first time, in which, we need to just give them the next semester
       *    The user has payed before, in which we need to essentially move them to the next bracket Fall -> Spring || Spring -> Fall
       */
      if (currentEndDate?.getTime() ?? 0 < new Date().getTime()) {
        // This is the first time the user is paying, so we simply look for the next bracket, and put them in there!
        if (new Date().getMonth() < 4) {
          return new Date(currentYear, 4, 5).toISOString();
        } else {
          return new Date(currentYear + 1, 0, 1).toISOString();
        }
      } else {
        //  The user still has valid dues, and needs to extend them
      }
    }
  }
};
