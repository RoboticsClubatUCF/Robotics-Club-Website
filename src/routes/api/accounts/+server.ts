import { db } from '$lib/db.js';

export async function GET({ url }) {
  // function returns an array of all users who have logged into the website
  let validUsers = await db.member.groupBy({
    by: ['discordProfileName'],
    where: {
      role: {
        permissionLevel: {
          gte: 0
        }
      }
    }
  });
  const users: string[] = [];
  validUsers.forEach((u) => {
    users.push(u.discordProfileName);
  });
  return new Response(JSON.stringify(users));
}