import { z } from "zod";
import type { Actions, PageServerLoad } from "./$types";
import { superValidate } from "sveltekit-superforms/server";
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
    allergies: z.string(),
    disabilities: z.string()
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
        
        console.log(form.data)

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
        //throw redirect(302, '/dashboard');
    }
};

