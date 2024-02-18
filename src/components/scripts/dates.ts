export function calculateValidSemester(currentEndDate: Date | undefined) {
	// slowly increment until the valid next due date is calculated
	let isValidSemester = false;
	let startingDate: Date = new Date();
	if ((currentEndDate?.getTime() ?? 0 > new Date().getTime()) && currentEndDate != undefined) {
		startingDate = currentEndDate;
	}
	let currentYear = new Date().getFullYear();
	// This is to calculate when their dues should end, should they pay for the semester option
	// This is the first time the user is paying, so we simply look for the next bracket, and put them in there!
	if (new Date().getMonth() < 4) {
		return new Date(currentYear, 4, 5);
	} else {
		return new Date(currentYear + 1, 0, 1);
	}
}
