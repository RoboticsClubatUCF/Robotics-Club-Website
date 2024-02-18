export function validSemesterFromForm(
  currentEndDate: Date | undefined,
  form: { data: { duesType: number } }
) {
  // slowly increment until the valid next due date is calculated
  let isValidSemester = false;
  let startingDate: Date = new Date();
  if ((currentEndDate?.getTime() ?? 0 > new Date().getTime()) && currentEndDate != undefined) {
    startingDate = currentEndDate;
  }
  let currentYear = new Date().getFullYear();
  // This is to calculate when their dues should end, should they pay for the semester option
  if (form.data.duesType == 1) {
    // This is the first time the user is paying, so we simply look for the next bracket, and put them in there!
    if (new Date().getMonth() < 4) {
      return new Date(currentYear, 4, 5).toISOString();
    } else {
      return new Date(currentYear + 1, 0, 1).toISOString();
    }
  } else if (form.data.duesType == 2) {
    //  THis is for if a user buys dues for a year
    return new Date(new Date().setFullYear(2024)).toISOString();
  }
}
export function validSemester(currentEndDate: Date | undefined, isYearly: boolean) {
  // slowly increment until the valid next due date is calculated
  let isValidSemester = false;
  let startingDate: Date = new Date();
  if ((currentEndDate?.getTime() ?? 0 > new Date().getTime()) && currentEndDate != undefined) {
    startingDate = currentEndDate;
  }
  let currentYear = new Date().getFullYear();
  // This is to calculate when their dues should end, should they pay for the semester option
  if (!isYearly) {
    // This is the first time the user is paying, so we simply look for the next bracket, and put them in there!
    if (new Date().getMonth() < 4) {
      return new Date(currentYear, 4, 5).toISOString();
    } else {
      return new Date(currentYear + 1, 0, 1).toISOString();
    }
  } else {
    //  THis is for if a user buys dues for a year
    return new Date(new Date().setFullYear(2024)).toISOString();
  }
}
