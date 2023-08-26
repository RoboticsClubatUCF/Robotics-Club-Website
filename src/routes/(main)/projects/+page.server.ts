import type { Project } from '@prisma/client';
import getprojects from '../../../components/querytools/projects/getprojects';
import type projectCategory from '../../../types/projectCategory';
import type { PageServerLoad } from './$types';

export const load = (async () => {
  /**
   * This should load all projects from the backend, and sort them based on year and season, such that people can sort through
   */

  // load all recent projects
  const projects = await getprojects(20);
  if (projects.length == 0) {
    let categories: projectCategory[] = [];
    return { categories };
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
    let projectsOfYear: Project[] = []; // the projects that happened in a certain year
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
            console.log(a.season);
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

  // sort by year
  categories.sort((a, b) => {
    return b.year - a.year;
  });
  return { categories };
}) satisfies PageServerLoad;
