import { z } from 'zod/v3';
import type { Actions, PageServerLoad } from "./$types";
import { setError, superValidate } from 'sveltekit-superforms';
import { zod } from '$lib/zodAdapter';
import { fail, redirect, error } from "@sveltejs/kit";
import { db } from "$lib/db";
import { Season } from '@prisma/client';

const createProSchema = z.object({
    title: z.string(),
    description: z.string(),
    docsLink: z.string(),
    season: z.string(),
    year: z.string(),
    logo: z.string(),
    Skills: z.string().array(),
});

export const load: PageServerLoad = async ({ locals }) => {
    if (locals.member.permissions.level < 8) {
        throw redirect(302, '/dashboard');
    }

    const members = await db.member.findMany({
        where: {
          email: {not: locals.member?.email},
        },
        select: {
          id: true,
          discordProfileName: true,
          firstName: true,
          lastName: true
        }
    });

    const form = await superValidate(zod(createProSchema));
    return { form, members };
};

export const actions: Actions = {
    default: async({ request, locals }) => {
        if (locals.member.permissions.level < 8) {
            throw error(403, 'Forbidden');
        }
        const form = await superValidate(request, zod(createProSchema));
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
        if (!vaildLogo.startsWith('https://')) {
            return setError(form, 'logo', 'Logo URL must start with https://');
        }
        if (vaildDocsLink === ''){
            return setError(form, 'docsLink', 'Please Enter a Docs-Link');
        }
        if (!vaildDocsLink.startsWith('https://')) {
            return setError(form, 'docsLink', 'Documentation URL must start with https://');
        }
        if (vaildSeason === ''){
            return setError(form, 'season', 'Please Enter a Season');
        }
        if (selectedyear === '' || !yearNum) {
            return setError(form, 'year', 'Please Enter a Valid Year');
        }
        // console.log("raw skills: ", form.data.Skills);
        const skillsArray = form.data.Skills[0].split(',');
        // console.log("split skills: ", skillsArray);

        // Creating survey entry in the database
        await db.project.create({
            data: {
                title: form.data.title,
                description: form.data.description,
                logo: {
                    create: {
                        data: form.data.logo,
                        isLocal: false,
                    }
                },
                docsLink: form.data.docsLink,
                season: form.data.season as Season,
                year: yearNum,
                Skills: skillsArray,
                budget: 0, 
                remainingFunds: 0,
            }
        });

        throw redirect(302, '/projects');
    }
};
