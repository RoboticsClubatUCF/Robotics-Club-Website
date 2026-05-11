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
	const month = now.getMonth();
	const year = now.getFullYear();
	const inSpring = month < 4; // Jan–Apr pay into spring, May+ pay into fall

	if (duesType === '1') {
		if (inSpring) {
			const [start, end] = await Promise.all([
				getSemesterStartDate(year, 'spring'),
				getSemesterEndDate(year, 'spring')
			]);
			const midpoint = new Date((start.getTime() + end.getTime()) / 2);
			// Past halfway through spring → roll forward to next semester (fall)
			return now > midpoint
				? getSemesterEndDate(year, 'fall')
				: end;
		} else {
			const [start, end] = await Promise.all([
				getSemesterStartDate(year, 'fall'),
				getSemesterEndDate(year, 'fall')
			]);
			const midpoint = new Date((start.getTime() + end.getTime()) / 2);
			// Past halfway through fall → roll forward to next semester (spring)
			return now > midpoint
				? getSemesterEndDate(year + 1, 'spring')
				: end;
		}
	}

	if (duesType === '2') {
		if (inSpring) {
			const [start, end] = await Promise.all([
				getSemesterStartDate(year, 'spring'),
				getSemesterEndDate(year, 'spring')
			]);
			const midpoint = new Date((start.getTime() + end.getTime()) / 2);
			// Early spring → spring + fall; late spring → fall + next spring
			return now > midpoint
				? getSemesterEndDate(year + 1, 'spring')
				: getSemesterEndDate(year, 'fall');
		} else {
			const [start, end] = await Promise.all([
				getSemesterStartDate(year, 'fall'),
				getSemesterEndDate(year, 'fall')
			]);
			const midpoint = new Date((start.getTime() + end.getTime()) / 2);
			// Early fall → fall + next spring; late fall → next spring + next fall
			return now > midpoint
				? getSemesterEndDate(year + 1, 'fall')
				: getSemesterEndDate(year + 1, 'spring');
		}
	}
}