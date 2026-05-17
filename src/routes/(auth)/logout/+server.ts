import { authCookieOptions } from '$lib/server/security';
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies }) => {
	cookies.delete('auth', authCookieOptions);
	throw redirect(302, '/');
};

export const GET: RequestHandler = async ({ cookies }) => {
	cookies.delete('auth', authCookieOptions);
	throw redirect(302, '/');
};
