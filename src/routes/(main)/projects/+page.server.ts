import type { Project } from '@prisma/client';
import getprojects from '../../../components/querytools/projects/getprojects';
import type projectCategory from '../../../types/projectCategory';
import type { PageServerLoad } from './$types';
import { getCurrentSemester } from '$lib/currentSemester';

export const load = (async () => {
  /**
   * This should load all projects from the backend, and sort them based on year and season, such that people can sort through
   */

  const [projects, dateInfo] = await Promise.all([
    getprojects(),
    getCurrentSemester()
  ]);

  if (projects.length == 0) {
    let categories: projectCategory[] = [];
    return { categories, currentYear: dateInfo.year, currentSemester: dateInfo.semester };
  }

  let categories: projectCategory[] = [];

  let years: number[] = [];
  // enumarate the years
  for (let i = 0; i < projects.length; i++) {
    if (!years.includes(projects[i].year)) {
      years.push(projects[i].year);
    }
  }
  for (let i = 0; i < years.length; i++) {
    let projectsOfYear: typeof projects[number][] = []; // the projects that happened in a certain year
    for (let j = 0; j < projects.length; j++) {
      if (projects[j].year == years[i]) {
        // if this project is on this year
        projectsOfYear.push(projects[j]);
        // if the year does not exist in the categories
        const x = categories.findIndex((a) => {
          return (a.year ?? -1) == years[i];
        });
        if (x == -1) {
          categories.push({
            year: years[i],
            semester: []
          });
        }
      }
    }
    for (let j = 0; j < projectsOfYear.length; j++) {
      // for every project in this year, we need to sort them into individual semesters,
      const x = categories.findIndex((a) => {
        return a.year == projectsOfYear[j].year;
      });
      if (x != undefined || x != -1) {
        try {
          const y = categories[x].semester.findIndex((a) => {
            return a.season == projectsOfYear[j].season;
          });
          // now since we have the semester, we can attempt to inject the project into it
          categories[x].semester[y].projects.push(projectsOfYear[j]);
        } catch (error) {
          // the semester doesnt exist, and is empty, need to create it
          categories[x].semester.push({
            season: projectsOfYear[j].season,
            projects: [projectsOfYear[j]]
          });
        }
      }
    }
    // now since everything is sorted, we can combine to the last datatype
  }

  const seasonOrder = { Summer: 0, Spring: 1, Fall: 2 };

  // sort by year descending, then within each year: Summer → Spring → Fall (top to bottom)
  categories.sort((a, b) => b.year - a.year);
  for (const cat of categories) {
    cat.semester.sort((a, b) => seasonOrder[a.season] - seasonOrder[b.season]);
  }
  return { categories, currentYear: dateInfo.year, currentSemester: dateInfo.semester };
}) satisfies PageServerLoad;
