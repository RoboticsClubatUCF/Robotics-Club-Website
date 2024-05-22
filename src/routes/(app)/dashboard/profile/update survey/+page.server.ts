import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { setError, superValidate } from 'sveltekit-superforms/server';
import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/db';
import type { Nullable } from '../../../../../types';

const editSurveySchema = z.object({
  gitName: z.string().optional(),
  ucfEmail: z.string().email().refine(email => email.endsWith('@ucf.edu'), {
    message: "Email must be a valid UCF email address (@ucf.edu)"
  }),
  Major: z.array(z.string()),
  oMajor: z.string().optional(),
  year: z.string(),
  semester: z.number(),
  shirtSize: z.string(),
  prevMem: z.string(),
  allergies: z.array(z.string()),
  oAllergies: z.string().optional(),
  otherConcerns: z.string().optional()
});

let surveyID: Nullable<number> = -1;

export const load = (async ({ parent }) => {
  const data = await parent();

  surveyID = data.member?.surveyId;
  if (!surveyID) {
    throw redirect(302, '/dashboard');  // or some appropriate error handling
  }
  
  const survey = await db.survey.findUnique({
    where: { id: surveyID }
  });

  if (!survey) {
    throw redirect(302, '/dashboard');  // or some appropriate error handling
  }

  // Create a form object with initial values from the survey
  const formValues = {
    gitName: survey.GitName || '',
    ucfEmail: survey.UCFemail || '',
    Major: survey.Major || [],
    oMajor: survey.OtherMajors || '',
    year: survey.Year || '',
    semester: survey.NumberofSemesters || 0,
    shirtSize: survey.ShirtSize || '',
    prevMem: survey.PrevMem || '',
    allergies: survey.Allergies || [],
    oAllergies: survey.OtherAllergies || '',
    otherConcerns: survey.Concerns || ''
  };

  const form = await superValidate(formValues, editSurveySchema);
  form.message = 'IDLE';

  return { user: data.member, form };
}) satisfies PageServerLoad;

export const actions: Actions = {
  default: async ({ request }) => {
    if(!surveyID){
      return fail(404, { surveyID})
    }

    const form = await superValidate(request, editSurveySchema);

    if (!form.valid) {
      form.message = 'NO';
      return fail(400, { form });
    }

    const selectedMajors = form.data.Major.filter(major => major !== '');
    const selectedyear = form.data.year;
    const selectedshirtSize = form.data.shirtSize;
    const selectedprevMem = form.data.prevMem;
    const selectedallergies = form.data.allergies.filter(allergy => allergy !== '');
    const enteredNum = form.data.semester;

    if (selectedMajors.length === 0) {
      return setError(form, 'Major', 'At least one of the options must be selected');
    }
    if (selectedMajors.includes("Other") && !form.data.oMajor) {
      return setError(form, 'oMajor', 'Please enter Major');
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
    if (enteredNum < 1 && selectedprevMem === 'Yes'){
      return setError(form, 'semester', 'Please enter a number >= 0');
    }
    if (enteredNum > 30){
      return setError(form, 'semester', 'Really?');
    }
    if (selectedallergies.length === 0) {
      return setError(form, 'allergies', 'At least one of the options must be selected');
    }
    if (selectedallergies.includes("None") && selectedallergies.length > 1) {
      return setError(form, 'allergies', 'Cannot have both None and allergen(s) selected');
    }
    if (selectedallergies.includes("Other") && !form.data.oAllergies) {
      return setError(form, 'oAllergies', 'Please enter Allergen(s)');
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
