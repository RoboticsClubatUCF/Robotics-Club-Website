import { db } from '$lib/db';
import { syncMemberRoles, removeProjectRole } from '$lib/discord';
import type { Handle } from '@sveltejs/kit';

async function sweepExpiredMemberships() {
  const expired = await db.member.findMany({
    where: {
      membershipExpDate: { lt: new Date() },
      role: { permissionLevel: { gte: 4, lt: 10 } }
    },
    include: {
      role: true,
      roles: true,
      Projects: { select: { id: true, discordRoleId: true } }
    }
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
    const effectiveRoles = member.roles.length > 0 ? member.roles : [member.role];
    const keepRoles = effectiveRoles.filter((r) => r.permissionLevel >= 10);
    const maxKept = keepRoles.reduce<(typeof effectiveRoles)[0] | null>(
      (max, r) => (!max || r.permissionLevel > max.permissionLevel ? r : max),
      null
    );
    const newPrimaryRole = maxKept ?? guestRole;

    // Remove Discord project roles before disconnecting from projects
    for (const project of member.Projects) {
      if (project.discordRoleId !== '1111111') {
        await removeProjectRole(member.discordProfileName, project.discordRoleId).catch((e) =>
          console.error('[Discord project expire]', member.discordProfileName, e)
        );
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    await db.member.update({
      where: { id: member.id },
      data: {
        role: { connect: { id: newPrimaryRole.id } },
        ...(member.roles.length > 0
          ? { roles: { set: keepRoles.map((r) => ({ id: r.id })) } }
          : {}),
        Projects: { set: [] }
      }
    });

    const result = await syncMemberRoles(
      member.discordProfileName,
      keepRoles.map((r) => r.name)
    );
    if (!result.success) {
      console.error('[Discord expire]', member.discordProfileName, result.error);
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`[Expiration sweep] Expired ${expired.length} membership(s)`);
}

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
