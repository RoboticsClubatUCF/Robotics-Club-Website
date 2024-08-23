import { z } from "zod";
import type { Actions, PageServerLoad } from "./$types";
import { superValidate } from "sveltekit-superforms/server";
import { fail, redirect } from "@sveltejs/kit";
import { db } from "$lib/db";

let pLevel = 0;

const appointTeamSchema = z.object({
    members: z.string().array(),
    teamId: z.string(),
});

export const load: PageServerLoad = async ({ parent, locals }) => {
    const data = await parent();
    pLevel = data.member!.role.permissionLevel;
    // check user permission level
    if (!(pLevel > 1)) {
        throw redirect(302, '/dashboard');
    }

    const teams = await db.team.findMany({
        where:{
            teamLead: {
                firstName: locals.member.fname,
            },
        },
        select:{
            id: true,
            name: true,
            teamLead: true,
            Project: true,
        }
    })

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

    const form = await superValidate(appointTeamSchema);
    return { form, teams, members };
};

export const actions: Actions = {
    default: async({ request }) => {
        const form = await superValidate(request, appointTeamSchema);
        // Validating forms
        if (!form.valid) {
            return fail(400, { form });
        }

        for(let i = 0; i < form.data.members.length; i++){
            console.log(form.data.members[i]);
            console.log(form.data.teamId);
            await db.team.update({
                where: {
                    id: form.data.teamId,
                },
                data: {
                    members: {
                        connect:{
                            id: form.data.members[i]
                        }
                    }
                }
            })
        }

        throw redirect(302, '/dashboard');
    }
};
