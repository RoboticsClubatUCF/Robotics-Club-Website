import { db } from '$lib/db';
import { syncMemberRoles } from '$lib/discord';
import type { Handle } from '@sveltejs/kit';

async function sweepExpiredMemberships() {
  const expired = await db.member.findMany({
    where: {
      membershipExpDate: { lt: new Date() },
      role: { permissionLevel: { gte: 4, lt: 10 } }
    },
    include: { role: true, roles: true }
  });

  if (expired.length === 0) return;

  const guestRole = await db.role.findFirst({
    where: { permissionLevel: 0 },
    orderBy: { permissionLevel: 'desc' }
  });

  if (!guestRole) {
    console.error('[Expiration sweep] No guest role found');
    return;
  }

  for (const member of expired) {
    // Use the roles many-to-many if populated; fall back to primary role for legacy members
    const effectiveRoles = member.roles.length > 0 ? member.roles : [member.role];

    // Retain only admin (>=999) and officer (>=10) roles on expiry
    const keepRoles = effectiveRoles.filter((r) => r.permissionLevel >= 10);
    const maxKept = keepRoles.reduce<(typeof effectiveRoles)[0] | null>(
      (max, r) => (!max || r.permissionLevel > max.permissionLevel ? r : max),
      null
    );
    const newPrimaryRole = maxKept ?? guestRole;

    await db.member.update({
      where: { id: member.id },
      data: {
        role: { connect: { id: newPrimaryRole.id } },
        ...(member.roles.length > 0
          ? { roles: { set: keepRoles.map((r) => ({ id: r.id })) } }
          : {})
      }
    });

    const result = await syncMemberRoles(
      member.discordProfileName,
      keepRoles.map((r) => r.name)
    );
    if (!result.success) {
      console.error('[Discord expire]', member.discordProfileName, result.error);
    }

    // Pause between members to stay within Discord rate limits
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`[Expiration sweep] Expired ${expired.length} membership(s)`);
}

// Run at startup and every hour. The globalThis guard prevents duplicate
// intervals from spawning on HMR hot-reloads in dev mode.
// @ts-ignore
if (!globalThis.__membershipSweepStarted) {
  // @ts-ignore
  globalThis.__membershipSweepStarted = true;
  sweepExpiredMemberships().catch((e) => console.error('[Expiration sweep]', e));
  setInterval(
    () => sweepExpiredMemberships().catch((e) => console.error('[Expiration sweep]', e)),
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
