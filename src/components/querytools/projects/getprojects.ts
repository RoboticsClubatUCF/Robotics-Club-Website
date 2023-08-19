import { db } from '$lib/db';

export default async (amount: number = 10, skip: number = 0) => {
  const projects = await db.project.findMany({
    skip: skip,
    take: amount,
    include: {
      logo: true
    },
    orderBy: {
      createdAt: 'desc'
    }
  });
  return projects;
};
