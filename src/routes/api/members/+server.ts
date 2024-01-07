import { db } from '$lib/db.js';

export async function GET({ url }) {
  // function returns an array of all users' discord names if they have a membership status of member
  const validUsers = await db.member.groupBy({
    by: ['discordProfileName'],
    where: {
      role: {
        permissionLevel: {
          gte: 4
        }
      }
    }
  });
  return new Response(JSON.stringify(validUsers));
}
