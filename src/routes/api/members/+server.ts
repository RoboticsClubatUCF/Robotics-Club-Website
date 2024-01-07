import { db } from '$lib/db.js';

export async function GET({ url }) {
  // function returns an array of all users' discord names if they have a membership status of member
  let validUsers = await db.member.groupBy({
    by: ['discordProfileName', 'membershipExpDate'],
    where: {
      role: {
        permissionLevel: {
          gte: 4
        }
      }
    }
  });
  const now = new Date().getTime();
  validUsers = validUsers.filter((m) => {
    if (!(m.membershipExpDate.getTime() < now)) {
      return m;
    }
  });
  return new Response(JSON.stringify(validUsers));
}
