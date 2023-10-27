import { db } from '$lib/db';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load = (async ({ params }) => {
  const project = await db.project.findFirst({
    where: {
      id: Number(params.slug)
    },
    include: {
      members: {
        orderBy: {
          role: {
            permissionLevel: 'desc'
          }
        },
        include: {
          role: true
        }
      },
      articles: {
        orderBy: {
          createdAt: 'desc'
        },
        take: 3,
        include: {
          author: true,
          Tags: true,
          image: true
        }
      },
      Tags: true,
      teams: {
        include: {
          members: true
        }
      },
      logo: true
    }
  });
  if (project == null) {
    throw error(404, 'Project not Found');
  }
  return { project };
}) satisfies PageServerLoad;
