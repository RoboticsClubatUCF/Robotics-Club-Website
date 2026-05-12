import { Season } from '@prisma/client';
import { getSemesterEndDate, getSemesterStartDate } from '$lib/ucfCalendar';
import semesterYear from '../components/scripts/semesterYear';

export async function getCurrentSemester(): Promise<{ year: number; semester: Season }> {
  const today = new Date();
  const year = today.getFullYear();

  try {
    const [springEnd, summerEnd, fallEnd] = await Promise.all([
      getSemesterEndDate(year, 'spring'),
      getSemesterEndDate(year, 'summer'),
      getSemesterEndDate(year, 'fall')
    ]);

    if (today < springEnd) return { year, semester: Season.Spring };
    if (today <= summerEnd) return { year, semester: Season.Summer };
    if (today <= fallEnd) return { year, semester: Season.Fall };
    return { year: year + 1, semester: Season.Spring };
  } catch {
    return semesterYear();
  }
}

/**
 * Returns whether today is within the 14-day grace period at the start of the
 * current fall or spring semester, along with the grace period expiry date.
 * Summer never has a grace period.
 */
export async function getGracePeriodInfo(): Promise<{ inGrace: boolean; expiry: Date | null }> {
  const today = new Date();
  const { year, semester } = await getCurrentSemester();

  if (semester === Season.Summer) return { inGrace: false, expiry: null };

  const seasonStr = semester === Season.Fall ? 'fall' : 'spring';
  try {
    const semesterStart = await getSemesterStartDate(year, seasonStr);
    const expiry = new Date(semesterStart);
    expiry.setDate(expiry.getDate() + 14);
    const inGrace = today >= semesterStart && today <= expiry;
    return inGrace ? { inGrace: true, expiry } : { inGrace: false, expiry: null };
  } catch {
    return { inGrace: false, expiry: null };
  }
}
