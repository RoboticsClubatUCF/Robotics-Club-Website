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
        console.log("Received Team ID:", form.data.teamId); // Verify received teamId
        console.log("Received Members:", form.data.members); // Verify received members

        // Split the string of member IDs into an array
        const memberIdsArray = form.data.members[0].split(',');

        // Map the array of member IDs to the format required by Prisma
        const memberConnections = memberIdsArray.map((memberId) => ({
            id: memberId.trim(),
        }));

        // Update the team with the connected members
        await db.team.update({
            where: {
                id: form.data.teamId,
            },
            data: {
                members: {
                    connect: memberConnections,
                },
            },
        });
        

        throw redirect(302, '/dashboard');
    }
};
