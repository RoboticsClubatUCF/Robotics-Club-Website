import { redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies }) => {
  cookies.set('session', '', {
    path: '/',
    expires: new Date(0)
  });
  throw redirect(302, '/');
  throw redirect(302, '/');
};

export const actions: Actions = {
  default: ({ request, cookies }) => {
    cookies.set('session', '', {
      path: '/',
      expires: new Date(0)
    });
    throw redirect(302, '/');
  }
};
