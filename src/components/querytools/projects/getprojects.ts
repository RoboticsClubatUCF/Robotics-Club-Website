import { PrismaClient } from '@prisma/client';

export default async (amount: number = 10, skip: number = 0) => {
  const db = new PrismaClient();
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
  db.$disconnect();
  return projects;
};
