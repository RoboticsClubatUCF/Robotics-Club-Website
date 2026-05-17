import { authCookieOptions, requirePermission, safeRedirectPath } from '$lib/server/security';
import { redirect } from '@sveltejs/kit';
import { ROLES } from '$lib/constants';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const to = safeRedirectPath(url.searchParams.get('to'));

	try {
		requirePermission(locals, ROLES.officer.level);
	} catch {
		throw redirect(302, to);
	}

	const enable = url.searchParams.get('enable') === 'true';

	if (enable) {
		cookies.set('editMode', 'true', {
			...authCookieOptions,
			maxAge: 60 * 60 * 24
		});
	} else {
		cookies.delete('editMode', authCookieOptions);
	}

	throw redirect(302, to);
};
