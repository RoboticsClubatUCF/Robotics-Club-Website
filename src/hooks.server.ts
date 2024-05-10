import { db } from '$lib/db';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  // get cookies from browser
  const session = event.cookies.get('session');

  if (!session) {
    // if there is no session load page as normal
    return await resolve(event);
  }

  // find the user based on the session
  const user = await db.member.findFirst({
    where: {
      AuthToken: session
    },
    include: {
      role: true
    }
  });

  // if `user` exists set `events.local`
  if (user) {
    event.locals.member = {
      fname: user.firstName,
      lname: user.lastName,
      email: user.email,
      permissions: {
        name: user.role.name,
        level: user.role.permissionLevel
      }
    };
  }

  // load page as normal
  return await resolve(event);
};
