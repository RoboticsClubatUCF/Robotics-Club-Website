import type { Prisma, Season } from '@prisma/client';

export default interface projectCategory {
  year: number;
  semester: {
    season: Season;
    projects: Prisma.ProjectGetPayload<{ include: { logo: true } }>[];
  }[];
}
