import { db } from '$lib/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const user = await db.member.findFirst({
    where: {
      email: locals.member.email
    }
  });
  const projects = await db.project.findMany({});
  return { user, projects };
};
