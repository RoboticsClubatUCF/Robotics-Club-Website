import { z } from "zod";
import type { Actions, PageServerLoad } from "./$types";
import { setError, superValidate } from "sveltekit-superforms/server";
import { fail, redirect } from "@sveltejs/kit";
import { db } from "$lib/db";
import { userInfo } from "os";

let userID = '';
const surSchema = z.object({
    // answers to questions here
    gitName: z.string(),
    ucfEmail: z.string().email(),
    Major: z.string().array(),
    year: z.string(),
    shirtSize: z.string(),
    prevMem: z.string(),
    allergies: z.string().array(),
    disabilities: z.string().array()
})

export const load = (async ({ parent }) => {
    const data = await parent();
    userID = data.member!.id;
    //@ts-ignore
    const form = await superValidate(data.member, surSchema);
    form.message = 'IDLE';
    return { user: data.member, form };
  }) satisfies PageServerLoad;

export const actions: Actions = {
    default: async({request}) => {
        const form = await superValidate(request, surSchema);

        // vaildating forms
        if(!form.valid){
            return fail(400, {form});
        }
        // pull information for error handeling and constraints
        const selectedMajors = form.data.Major.filter(major => major !== '');
        const selectedyear = form.data.year;
        const selectedshirtSize = form.data.shirtSize;
        const selectedprevMem = form.data.prevMem;
        const selectedallergies = form.data.allergies.filter(allergies => allergies !== '');
        const selecteddisabilities = form.data.disabilities.filter(allergies => allergies !== '');


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
        if (selectedyear === ''){
            return setError(form, 'year', 'At least one of the options must be selected');
        }
        if (selectedshirtSize === ''){
            return setError(form, 'shirtSize', 'At least one of the options must be selected');
        }
        if (selectedprevMem === ''){
            return setError(form, 'prevMem', 'At least one of the options must be selected');
        }
        if (selectedallergies.length === 0) {
            return setError(form, 'allergies', 'At least one of the options must be selected');
        }
        if (selecteddisabilities.length === 0) {
            return setError(form, 'disabilities', 'At least one of the options must be selected');
        }



        
        // console.log(form.data.year)

        await db.survey.create({
            data: {
                GitName: form.data.gitName,
                UCFemail: form.data.ucfEmail,
                Major: form.data.Major,
                Year: form.data.year,
                ShirtSize: form.data.shirtSize,
                PrevMem: form.data.prevMem,
                Allergies: form.data.allergies,
                Disabilities: form.data.disabilities,
                Member: {
                    connect:{
                        id: userID
                    }
                } 
            }
        });
        throw redirect(302, '/dashboard');
    }
};

