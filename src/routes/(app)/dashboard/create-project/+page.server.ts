import { z } from "zod";
import type { Actions, PageServerLoad } from "./$types";
import { setError, superValidate } from "sveltekit-superforms/server";
import { fail, redirect } from "@sveltejs/kit";
import { db } from "$lib/db";

let pLevel = 0;

const createProSchema = z.object({
    title: z.string(),
    description: z.string(),
    docsLink: z.string(),
    season: z.custom(),
    year: z.string(),
    logo: z.string(),
    Skills: z.string().array(),
});

export const load: PageServerLoad = async ({ parent }) => {
    const data = await parent();
    pLevel = data.member!.role.permissionLevel;
    // check user permission level
    if (!(pLevel > 3)) {
        throw redirect(302, '/dashboard');
    }

    const form = await superValidate(createProSchema);
    return { form };
};

export const actions: Actions = {
    default: async({ request }) => {
        const form = await superValidate(request, createProSchema);
        // Validating forms
        if (!form.valid) {
            return fail(400, { form });
        }

        const selectedyear = form.data.year;
        const vaildTitle = form.data.title;
        const vaildDocsLink = form.data.docsLink;
        const vaildSeason = form.data.season;
        const vaildLogo = form.data.logo;
        const yearNum = parseInt(selectedyear);


        if (vaildTitle === ''){
            return setError(form, 'title', 'Please Enter a Title');
        }
        if (vaildLogo === ''){
            return setError(form, 'logo', 'Please Enter a Logo-Link');
        }
        if (vaildDocsLink === ''){
            return setError(form, 'docsLink', 'Please Enter a Docs-Link');
        }
        if (vaildSeason === ''){
            return setError(form, 'season', 'Please Enter a Season');
        }
        if (selectedyear === '' || !yearNum) {
            return setError(form, 'year', 'Please Enter a Valid Year');
        }


        // Creating survey entry in the database
        await db.project.create({
            data: {
                title: form.data.title,
                description: form.data.description,
                logo: {
                    create: {
                        data: form.data.logo,
                    }
                },
                docsLink: form.data.docsLink,
                season: form.data.season,
                year: yearNum,
                Skills: form.data.Skills,
                budget: 0, 
                remainingFunds: 0,

            }
        });

        throw redirect(302, '/dashboard');
    }
};
