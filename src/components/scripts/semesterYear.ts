import { Season } from '@prisma/client';

export default () => {
  const currMonth = new Date().getMonth(); // 0-11
  const currYear = new Date().getFullYear();
  if (currMonth < 4) {
    return {
      year: currYear,
      semester: Season.Spring
    };
  } else if (currMonth > 4 && currMonth < 7) {
    return {
      year: currYear,
      semester: Season.Summer
    };
  }
  return {
    year: currYear,
    semester: Season.Fall
  };
};
