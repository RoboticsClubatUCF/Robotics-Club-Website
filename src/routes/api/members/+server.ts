import { db } from '$lib/db.js';

export async function GET({ url }) {
  // function returns an array of all users' discord names if they have a membership status of member
  await db.member.findMany({
    where: {
      role: {
        name: ''
      }
    }
  });
}
