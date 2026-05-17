import { prisma } from '$lib/server/prisma';
import { authCookieOptions } from '$lib/server/security';
import { initCalendarService } from '$lib/ucfCalendar';
import { sweepExpiredMemberships } from '$lib/membershipSweep';
import { dev } from '$app/environment';
import type { Handle } from '@sveltejs/kit';

declare global {
	var __membershipSweepStarted: boolean | undefined;
}

async function runSweep() {
	try {
		const lines = await sweepExpiredMemberships();
		console.log('[Expiration sweep]', lines.at(-1));
	} catch (e) {
		console.error('[Expiration sweep] Failed:', e);
	}
}

if (!globalThis.__membershipSweepStarted) {
	globalThis.__membershipSweepStarted = true;
	initCalendarService().catch((e) => console.error('[UCF Calendar] Initialization failed:', e));
	runSweep();
	// Run sweep every hour
	setInterval(runSweep, 60 * 60 * 1000);
}

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get('auth');

	if (!token) {
		event.locals.user = null;
		return await resolve(event);
	}

	try {
		const user = await prisma.user.findUnique({
			where: { authToken: token },
			include: { role: true, survey: true }
		});

		if (!user) {
			event.cookies.delete('auth', authCookieOptions);
			event.locals.user = null;
			return await resolve(event);
		}

		event.locals.user = {
			id: user.id,
			firstName: user.firstName,
			lastName: user.lastName,
			ucfEmail: user.ucfEmail,
			discordUserName: user.discordUserName,
			role: user.role,
			membershipExpDate: user.membershipExpDate,
			hasSurvey: !!user.survey
		};
	} catch (e) {
		console.error('[Auth Hook] Error fetching user:', e);
		event.locals.user = null;
	}

	return await resolve(event);
};
