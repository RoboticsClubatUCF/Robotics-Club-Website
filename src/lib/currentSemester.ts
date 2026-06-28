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
 * Returns whether today is within the grace period for the current fall or spring
 * semester, along with the date that period expires.
 *
 * The window runs from the moment the semester is classified through 14 days after
 * classes begin. Because getCurrentSemester flips to the next term at the *previous*
 * term's end date, this start point is the beginning of the inter-semester break, so
 * the grace period deliberately covers the whole break (summer→fall and winter) —
 * returning members aren't demoted before the new semester has even started.
 * Summer never has a grace period (membership is free, enforcement is already paused).
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
    // No lower bound by design: getCurrentSemester already flips to this term at the
    // prior term's end, so "today <= classes-begin + 14" spans the break plus the
    // first two weeks of the semester. Re-adding `today >= semesterStart` would strip
    // roles during the break (e.g. Aug 2–24, Dec 11–Jan 12) — exactly what this guards.
    const inGrace = today <= expiry;
    return inGrace ? { inGrace: true, expiry } : { inGrace: false, expiry: null };
  } catch {
    return { inGrace: false, expiry: null };
  }
}
