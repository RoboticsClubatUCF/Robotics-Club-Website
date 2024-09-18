import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { setError, superValidate } from 'sveltekit-superforms/server';
import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/db';

let userEmail = '';
console.log('On Inital: ' + userEmail);
const surSchema = z.object({
  // answers to questions here
  gitName: z.string(),
  ucfEmail: z
    .string()
    .email()
    .refine((email) => email.endsWith('@ucf.edu'), {
      message: 'Email must be a valid UCF email address (@ucf.edu)'
    }),
  Major: z.string().array().min(1,"Select a Major or 'Other'"),
  oMajor: z.string().optional(),
  year: z.string().min(1, "Select a Year"),
  semester: z.number(),
  shirtSize: z.string().min(1, "Select a Shirt Size"),
  prevMem: z.string().min(1, "Select 'Yes' or 'No'"),
  discover: z.string().array().min(1, "Select One of The Options"),
  allergies: z.string().array().min(1, "Select One of The Options or 'None'"),
  oAllergies: z.string().optional(),
  otherConcerns: z.string().optional()
});

export const load: PageServerLoad = async ({ locals, parent }) => {
  userEmail = locals.member?.email ?? (await parent()).member.email;

  // Check if user already has a survey
  const existingSurvey = await db.survey.findFirst({
    where: {
      Member: {
        some: {
          email: userEmail
        }
      }
    }
  });

  if (existingSurvey) {
    throw redirect(302, '/dashboard');
  } else {
    console.log('On load userEmail: ' + userEmail);
  }

  const form = await superValidate(surSchema);
  return { form };
};

export const actions: Actions = {
  default: async ({ request }) => {
    const form = await superValidate(request, surSchema);

    // Validating forms
    if (!form.valid) {
      return fail(400, { form });
    }

    // Check if the user already has a survey to handle condition
    if (
      await db.survey.findFirst({
        where: {
          UCFemail: form.data.ucfEmail
        }
      })
    ) {
      return setError(form, 'ucfEmail', 'Email is already being used!');
    }

    const selectedprevMem = form.data.prevMem;
    const enteredNum = form.data.semester;

    if (enteredNum < 1 && selectedprevMem === 'Yes') {
      return setError(form, 'semester', 'Please enter a number >= 0');
    }
    if (enteredNum > 30) {
      return setError(form, 'semester', 'Really?');
    }

    console.log('On create userEmail: ' + userEmail);

    // Creating survey entry in the database
    await db.survey.create({
      data: {
        GitName: form.data.gitName,
        UCFemail: form.data.ucfEmail,
        Major: form.data.Major,
        OtherMajors: form.data.oMajor,
        Year: form.data.year,
        NumberofSemesters: form.data.semester,
        ShirtSize: form.data.shirtSize,
        PrevMem: form.data.prevMem,
        DiscoveredThrough: form.data.discover,
        Allergies: form.data.allergies,
        OtherAllergies: form.data.oAllergies,
        Concerns: form.data.otherConcerns,
        Member: {
          connect: {
            email: userEmail
          }
        }
      }
    });

    throw redirect(302, '/dashboard');
  }
};
