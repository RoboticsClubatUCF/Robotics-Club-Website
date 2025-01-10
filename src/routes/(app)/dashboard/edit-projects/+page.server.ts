import { z } from "zod";
import type { Actions, PageServerLoad } from "./$types";
import { setError, superValidate } from "sveltekit-superforms/server";
import { fail, redirect } from "@sveltejs/kit";
import { db } from "$lib/db";
import { prisma } from "$lib/server/prisma";

let pLevel = 0;

const editProSchema = z.object({
    title: z.string().min(1, "Title is required."),
    description: z.string().optional(),
    docsLink: z.string().url("Invalid URL format."),
    season: z.enum(["Fall", "Spring", "Summer"]),
    year: z.string().regex(/^\d{4}$/, "Year must be a 4-digit number."),
    logo: z.string().url("Invalid URL format."),
    Skills: z.string().array().optional(),
    id: z.number()
});

const projectSelectionSchema = z.object({
    id: z.number()
})

export const load: PageServerLoad = async ({ parent }) => {
    const data = await parent();
    pLevel = data.member!.role.permissionLevel;
    // check user permission level
    if (!(pLevel > 3)) {
        throw redirect(302, '/dashboard');
    }

    // Fetch all projects
    const allProjects = await prisma.project.findMany({
    // You can include other relations if needed, like `member` or `tasks`
    });
       
    const form = await superValidate(editProSchema);
    const selectionForm = await superValidate(projectSelectionSchema);

    console.log("On load Project id is: " + form.data.id);

    const currentProject = await db.project.findUnique({
        where: {id: form.data.id}
    })

    return {
        form, selectionForm, currentProject,
        member: {
            Projects: allProjects // Pass all projects to the frontend
        }
    };
};

// Handle form submission
export const actions: Actions = {
    selectProject: async ({ request }) => {
        console.log("Project select has been triggered!");
        // Parse the form data
        const form = await superValidate(request, projectSelectionSchema);
    
        if (!form.valid) {
            return fail(400, { form });
        }
    
        const projectId = form.data.id;
    
        // Find the project
        const project = await db.project.findUnique({
            where: { id: projectId },
        });

        console.log(project);
    
        if (!project) {
            return setError(form, 'id', 'Project not found.');
        }else{
            return { form, currentProject: project };
        }
    },
    

    updateProject: async ({ request }) => {
        // Parse the form data
        const form = await superValidate(request, editProSchema);

        // If form validation fails, return with errors
        if (!form.valid) {
            return fail(400, { form });
        }
    }
};

