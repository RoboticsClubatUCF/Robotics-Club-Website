import { number, z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { setError, superValidate } from 'sveltekit-superforms/server';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/db';

const editSurveySchema = z.object({
  // answers to questions here
  gitName: z.string(),
  ucfEmail: z.string().email().refine(email => email.endsWith('@ucf.edu'), {
      message: "Email must be a valid UCF email address (@ucf.edu)"
  }),
  Major: z.string().array(),
  oMajor: z.string().optional(),
  year: z.string(),
  semester: z.number(),
  shirtSize: z.string(),
  prevMem: z.string(),
  allergies: z.string().array(),
  oAllergies: z.string().optional(),
  otherConcerns: z.string().optional()
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
    // pull information for error handeling and constraints
    const selectedMajors = form.data.Major.filter(major => major !== '');
      const selectedyear = form.data.year;
      const selectedshirtSize = form.data.shirtSize;
      const selectedprevMem = form.data.prevMem;
      const selectedallergies = form.data.allergies.filter(allergies => allergies !== '');
      const enteredNum = form.data.semester;

    if (
      (await db.survey.findFirst({
        where: {
          UCFemail: form.data.ucfEmail
        }
      })) != null
    ) {
      return setError(form, 'ucfEmail', 'Email is already being used!');
    }
    if (selectedMajors.length === 0) {
      return setError(form, 'Major', 'At least one of the options must be selected');
    }
    if (selectedyear === '') {
        return setError(form, 'year', 'At least one of the options must be selected');
    }
    if (selectedshirtSize === '') {
        return setError(form, 'shirtSize', 'At least one of the options must be selected');
    }
    if (selectedprevMem === '') {
        return setError(form, 'prevMem', 'At least one of the options must be selected');
    }
    if (enteredNum < 1){
        return setError(form, 'semester', 'Please enter a number >= 0');
    }
    if (enteredNum > 30){
        return setError(form, 'semester', 'Really?');
    }
    if (selectedallergies.length === 0) {
        return setError(form, 'allergies', 'At least one of the options must be selected');
    }
    // New validation for allergies: "None" should not be selected with other allergies
    if (selectedallergies.includes("None") && selectedallergies.length > 1) {
        return setError(form, 'allergies', 'Connot have both None and allergen(s) selected');
    }

    await db.survey.update({
      where: { id: surveyID },
      data: {
        GitName: form.data.gitName,
        UCFemail: form.data.ucfEmail,
        Major: form.data.Major,
        OtherMajors: form.data.oMajor,
        Year: form.data.year,
        NumberofSemesters: form.data.semester,
        ShirtSize: form.data.shirtSize,
        PrevMem: form.data.prevMem,
        Allergies: form.data.allergies,
        OtherAllergies: form.data.oAllergies,
        Concerns: form.data.otherConcerns,
      }
    });
    form.message = 'OK';
    return { form };
  }
};
