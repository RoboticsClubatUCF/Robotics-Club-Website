import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  if (!locals.member) {
    return { user: false };
  }
  return { user: true };
};
