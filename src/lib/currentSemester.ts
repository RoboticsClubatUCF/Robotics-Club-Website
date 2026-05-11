import { Season } from '@prisma/client';
import { getSemesterEndDate, getSemesterStartDate } from '$lib/ucfCalendar';
import semesterYear from '../components/scripts/semesterYear';

export async function getCurrentSemester(): Promise<{ year: number; semester: Season }> {
  const today = new Date();
  const year = today.getFullYear();

  try {
    const [springEnd, fallStart] = await Promise.all([
      getSemesterEndDate(year, 'spring'),
      getSemesterStartDate(year, 'fall')
    ]);

    if (today < springEnd) return { year, semester: Season.Spring };
    if (today < fallStart) return { year, semester: Season.Summer };
    return { year, semester: Season.Fall };
  } catch {
    return semesterYear();
  }
}

/**
 * Returns true if today is within the 14-day grace period at the start of the given
 * fall or spring semester. Always returns false for Summer — summer uses a separate
 * free-entry path (the summerRole action) and does not have a grace period.
 */
export async function isInGracePeriod(semester: Season, year: number): Promise<boolean> {
  if (semester === Season.Summer) return false;
  const seasonStr = semester === Season.Fall ? 'fall' : 'spring';
  try {
    const semesterStart = await getSemesterStartDate(year, seasonStr);
    const gracePeriodEnd = new Date(semesterStart);
    gracePeriodEnd.setDate(gracePeriodEnd.getDate() + 14);
    return new Date() <= gracePeriodEnd;
  } catch {
    return false;
  }
}
