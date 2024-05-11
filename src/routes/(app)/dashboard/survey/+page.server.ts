import { z } from "zod";
import type { Actions, PageServerLoad } from "./$types";
import { superValidate } from "sveltekit-superforms/server";
import { fail } from "@sveltejs/kit";
const surSchema = z.object({
    // ask questions here
    gitName: z.string(),
    ucfEmail: z.string().email(),
    Major: z.string(),
    year: z.string(),
    shirtSize: z.string(),
    prevMem: z.boolean(),
    allergies: z.string(),
    disabilities: z.string()
})

export const load: PageServerLoad = async () => {
    // handles transition front-end and back-end
    const form = await superValidate(surSchema);

    return{form};
};

export const actions: Actions = {
    default: async({request}) => {
        const form = await superValidate(request, surSchema);

        // vaildating forms
        if(!form.valid){
            return fail(400, {form});
        }
        console.log(form.data)
    }
};

