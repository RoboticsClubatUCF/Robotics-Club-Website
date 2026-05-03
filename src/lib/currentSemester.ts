import { Season } from '@prisma/client';
import { getSemesterEndDate, getSemesterStartDate } from '$lib/ucfCalendar';
import semesterYear from '../components/scripts/semesterYear';

/**
 * Determines the active semester using live UCF academic calendar dates.
 * Falls back to the hardcoded month-based logic if the UCF feed is unavailable.
 *
 * Boundaries (derived from UCF dates):
 *   today < spring end                    → Spring
 *   spring end <= today < fall start      → Summer
 *   today >= fall start                   → Fall
 */
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
