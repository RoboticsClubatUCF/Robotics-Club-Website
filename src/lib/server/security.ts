import { ROLES } from '$lib/constants';
import { error } from '@sveltejs/kit';
import { dev } from '$app/environment';

export const authCookieOptions = {
	path: '/',
	httpOnly: true,
	sameSite: 'strict' as const,
	secure: !dev
};

export function requirePermission(locals: App.Locals, minimumLevel: number = ROLES.admin.level) {
	if (!locals.user || locals.user.role.permissionLevel < minimumLevel) {
		throw error(403, 'Forbidden');
	}

	return locals.user;
}

export function assertSameOrigin(request: Request, url: URL) {
	const origin = request.headers.get('origin');
	if (origin && origin !== url.origin) {
		throw error(403, 'Invalid request origin');
	}
}

export function safeRedirectPath(value: string | null, fallback = '/') {
	if (!value || !value.startsWith('/') || value.startsWith('//')) return fallback;

	try {
		const parsed = new URL(value, 'https://rccf.local');
		return `${parsed.pathname}${parsed.search}${parsed.hash}`;
	} catch {
		return fallback;
	}
}

export function parseId(value: FormDataEntryValue | string | null | undefined) {
	if (typeof value !== 'string') return null;
	const id = Number(value);
	return Number.isInteger(id) && id > 0 ? id : null;
}

export function isHttpsUrl(value: string) {
	try {
		const url = new URL(value);
		return url.protocol === 'https:' && !!url.hostname;
	} catch {
		return false;
	}
}
