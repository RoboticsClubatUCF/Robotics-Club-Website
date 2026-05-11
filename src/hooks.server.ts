import { db } from '$lib/db';
import { initCalendarService } from '$lib/ucfCalendar';
import { sweepExpiredMemberships } from '$lib/membershipSweep';
import type { Handle } from '@sveltejs/kit';

async function runSweep() {
  const lines = await sweepExpiredMemberships();
  console.log('[Expiration sweep]', lines.at(-1));
}

// @ts-ignore
if (!globalThis.__membershipSweepStarted) {
  // @ts-ignore
  globalThis.__membershipSweepStarted = true;
  initCalendarService().catch((e) => console.error('[UCF Calendar]', e));
  runSweep().catch((e) => console.error('[Expiration sweep]', e));
  setInterval(
    () => runSweep().catch((e) => console.error('[Expiration sweep]', e)),
    60 * 60 * 1000
  );
}

export const handle: Handle = async ({ event, resolve }) => {
  const session = event.cookies.get('session');

  if (!session) {
    return await resolve(event);
  }

  const user = await db.member.findFirst({
    where: { AuthToken: session },
    include: { role: true }
  });

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

  return await resolve(event);
};
