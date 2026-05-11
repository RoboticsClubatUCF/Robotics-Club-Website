import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals, cookies }) => {
  const enable = url.searchParams.get('enable') === 'true';
  const returnTo = url.searchParams.get('to') || '/';

  if (!locals.member || locals.member.permissions.level < 10) {
    throw redirect(302, returnTo);
  }

  if (enable) {
    cookies.set('editMode', 'true', {
      path: '/',
      maxAge: 60 * 60 * 24,
      httpOnly: true,
      sameSite: 'lax',
      secure: false
    });
  } else {
    cookies.delete('editMode', { path: '/' });
  }

  throw redirect(302, returnTo);
};
