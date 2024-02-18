import { db } from '$lib/db';
import { calculateValidSemester } from '../../../../components/scripts/dates';
import type { PageServerLoad } from './$types';

export const load = (async ({ params }) => {
  const user_ = await db.member.findFirst({
    where: {
      id: params.slug
    }
  });
  if (user_) {
    await db.member.update({
      where: {
        id: params.slug
      },
      data: {
        membershipExpDate: calculateValidSemester(user_?.membershipExpDate),
        role: {
          connect: {
            name: 'member'
          }
        }
      }
    });
  }
  return {};
}) satisfies PageServerLoad;
