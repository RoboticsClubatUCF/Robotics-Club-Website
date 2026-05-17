import { Season } from '@prisma/client';
import { getSemesterEndDate, getSemesterStartDate } from '$lib/ucfCalendar';

function fallbackSemesterYear(): { year: number; semester: Season } {
	const today = new Date();
	const month = today.getMonth();
	const year = today.getFullYear();
	if (month < 4) return { year, semester: Season.spring };
	if (month < 7) return { year, semester: Season.summer };
	return { year, semester: Season.fall };
}

export async function getCurrentSemester(): Promise<{ year: number; semester: Season }> {
	const today = new Date();
	const year = today.getFullYear();

	try {
		const [springEnd, summerEnd, fallEnd] = await Promise.all([
			getSemesterEndDate(year, 'spring'),
			getSemesterEndDate(year, 'summer'),
			getSemesterEndDate(year, 'fall')
		]);

		if (today < springEnd) return { year, semester: Season.spring };
		if (today <= summerEnd) return { year, semester: Season.summer };
		if (today <= fallEnd) return { year, semester: Season.fall };
		return { year: year + 1, semester: Season.spring };
	} catch {
		return fallbackSemesterYear();
	}
}

export async function getGracePeriodInfo(): Promise<{ inGrace: boolean; expiry: Date | null }> {
	const today = new Date();
	const { year, semester } = await getCurrentSemester();

	if (semester === Season.summer) return { inGrace: false, expiry: null };

	const seasonStr = semester === Season.fall ? 'fall' : 'spring';
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
