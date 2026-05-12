import { duesStoreType } from '../../stores';
import { getSemesterStartDate, getSemesterEndDate } from '$lib/ucfCalendar';

export async function calculateValidSemester(
	currentEndDate: Date | undefined,
	duesTypeParam?: string
): Promise<Date | undefined> {
	let duesType = duesTypeParam ?? '';
	if (!duesType) {
		duesStoreType.subscribe((value) => { duesType = value; });
	}

	const now = new Date();
	const year = now.getFullYear();

	const [springStart, springEnd, summerEnd, fallStart, fallEnd, nextSpringEnd, nextFallEnd] =
		await Promise.all([
			getSemesterStartDate(year, 'spring'),
			getSemesterEndDate(year, 'spring'),
			getSemesterEndDate(year, 'summer'),
			getSemesterStartDate(year, 'fall'),
			getSemesterEndDate(year, 'fall'),
			getSemesterEndDate(year + 1, 'spring'),
			getSemesterEndDate(year + 1, 'fall')
		]);

	const threeQuarters = (start: Date, end: Date) =>
		new Date(start.getTime() + (end.getTime() - start.getTime()) * 0.75);

	if (now <= summerEnd) {
		// Spring, spring-to-summer gap, or summer
		if (now > springEnd) return undefined; // summer is free

		// During spring: check the 3/4 cutoff
		const cutoff = threeQuarters(springStart, springEnd);
		if (now <= cutoff) {
			if (duesType === '1') return springEnd;
			if (duesType === '2') return fallEnd;
		} else {
			// Past 3/4 of spring → roll to fall
			if (duesType === '1') return fallEnd;
			if (duesType === '2') return nextSpringEnd;
		}
	} else {
		// Summer-to-fall gap, fall, or fall-to-spring gap
		if (now > fallEnd) {
			// Fall-to-spring gap → pay for next spring
			if (duesType === '1') return nextSpringEnd;
			if (duesType === '2') return nextFallEnd;
		} else {
			// Summer-to-fall gap or during fall: check the 3/4 cutoff
			const cutoff = threeQuarters(fallStart, fallEnd);
			if (now <= cutoff) {
				if (duesType === '1') return fallEnd;
				if (duesType === '2') return nextSpringEnd;
			} else {
				// Past 3/4 of fall → roll to next spring
				if (duesType === '1') return nextSpringEnd;
				if (duesType === '2') return nextFallEnd;
			}
		}
	}
}