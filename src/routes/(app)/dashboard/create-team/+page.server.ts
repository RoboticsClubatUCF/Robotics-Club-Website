import { z } from "zod";
import type { Actions, PageServerLoad } from "./$types";
import { superValidate } from "sveltekit-superforms/server";
import { fail, redirect } from "@sveltejs/kit";
import { db } from "$lib/db";

let pLevel = 0;

const createTeamSchema = z.object({
    projectId: z.number(),
    name: z.string(),
    teamLead: z.string(),
});

export const load: PageServerLoad = async ({ parent, locals }) => {
    const data = await parent();
    pLevel = data.member!.role.permissionLevel;
    // check user permission level
    if (!(pLevel > 2)) {
        throw redirect(302, '/dashboard');
    }

    const members = await db.member.findMany({
        where: {
          email: {not: locals.member?.email}
        },
        select: {
          id: true,
          discordProfileName: true,
          firstName: true,
          lastName: true
        }
      });
    
    const projects = await db.project.findMany({
    select: {
        id: true,
        title: true,
        season: true,
        year: true,
        projectType: true,
    }
    });

    const form = await superValidate(createTeamSchema);
    return { form, projects, members };
};

export const actions: Actions = {
    default: async({ request }) => {
        const form = await superValidate(request, createTeamSchema);
        // Validating forms
        if (!form.valid) {
            return fail(400, { form });
        }

        await db.team.create({
            data:{
                name: form.data.name,
                teamLead: {
                    connect: {
                        id: form.data.teamLead,
                    }
                },
                Project: {
                    connect: {
                        id: form.data.projectId,
                    }
                },
                // to be changed later down the line
                maxMembers: 0,
                minMembers: 0,
            }            
        });

        //update member acess
        await db.member.update({
            where:{
                id: form.data.teamLead,
            },
            data:{
                role: {
                    connect: {
                        name: 'team lead',
                    }
                }
            }
        })
        throw redirect(302, '/dashboard');
    }
};
