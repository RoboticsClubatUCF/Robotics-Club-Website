import { db } from '$lib/db';
import { syncMemberRoles, removeProjectRole } from '$lib/discord';
import { initCalendarService } from '$lib/ucfCalendar';
import type { Handle } from '@sveltejs/kit';

async function sweepExpiredMemberships() {
  const expired = await db.member.findMany({
    where: {
      membershipExpDate: { lt: new Date() },
      // Include members through officers (4–998); admins (999+) are never swept.
      role: { permissionLevel: { gte: 4, lt: 999 } }
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
    // Keep officer-level roles (10+); everything else is cleared on expiry.
    const keepRoles = effectiveRoles.filter((r) => r.permissionLevel >= 10);
    // Always fall back to [guest] so roles is never left empty.
    const newRoles = keepRoles.length > 0 ? keepRoles : [guestRole];
    const newPrimaryRole = newRoles.reduce(
      (max, r) => (r.permissionLevel > max.permissionLevel ? r : max),
      guestRole
    );

    // Remove all Discord project roles before disconnecting from projects.
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
        // role always mirrors the highest entry in roles.
        role: { connect: { id: newPrimaryRole.id } },
        roles: { set: newRoles.map((r) => ({ id: r.id })) },
        Projects: { set: [] }
      }
    });

    // keepRoles names: empty array clears all Discord roles for regular members;
    // ['officer'] (or similar) keeps officer/admin Discord roles for those ranks.
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
  initCalendarService().catch((e) => console.error('[UCF Calendar]', e));
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
