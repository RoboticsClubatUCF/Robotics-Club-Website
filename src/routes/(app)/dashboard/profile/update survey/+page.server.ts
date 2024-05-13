import { number, z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { superValidate } from 'sveltekit-superforms/server';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/db';

const editSurveySchema = z.object({
  gitName: z.string().optional(),
  ucfEmail: z.string().email(),
  Major: z.string().array(),
  year: z.string(),
  shirtSize: z.string(),
  prevMem: z.string(),
  allergies: z.string().array(),
  disabilities: z.string().array()
});

let surveyID = -1;
export const load = (async ({ parent }) => {
  const data = await parent();
  
  surveyID = data.member ? data.member.surveyId || 0 : 0;
  //@ts-ignore
  const form = await superValidate(data.member, editSurveySchema);
  form.message = 'IDLE';
  return { user: data.member, form };
}) satisfies PageServerLoad;

export const actions: Actions = {
  default: async ({ request }) => {
    const form = await superValidate(request, editSurveySchema);

    if (!form.valid) {
      // Again, return { form } and things will just work.
      form.message = 'NO';
      return fail(400, { form });
    }
    await db.survey.update({
      where: { id: surveyID },
      data: {
        GitName: form.data.gitName,
        UCFemail: form.data.ucfEmail,
        Major: form.data.Major,
        Year: form.data.year,
        ShirtSize: form.data.shirtSize,
        PrevMem: form.data.prevMem,
        Allergies: form.data.allergies,
        Disabilities: form.data.disabilities,
      }
    });
    form.message = 'OK';
    return { form };
  }
};
