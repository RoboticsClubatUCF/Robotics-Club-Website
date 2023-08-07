import type { Project, Season } from '@prisma/client';

export default interface projectCategory {
  year: number;
  semester: {
    season: Season;
    projects: Project[];
  }[];
}
