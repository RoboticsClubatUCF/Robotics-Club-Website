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

  categories.push({
    year: projects[0].year,
    semester: [
      {
        season: projects[0].season,
        projects: [projects[0]]
      }
    ]
  } satisfies projectCategory);

  let years: number[] = [];
  // enumarate the years
  for (let i = 1; i < projects.length; i++) {
    if (!years.includes(projects[i].year)) {
      years.push(projects[i].year);
    }
  }
  for (let i = 0; i < years.length; i++) {
    let projectsOfYear: Project[] = []; // the projects that happened in a certain year
    for (let j = 1; j < projects.length; j++) {
      if (projects[j].year == years[i]) {
        // if this project is on this year
        projectsOfYear.push(projects[j]);
        // if the year does not exist in the categories
        const x = categories.findIndex((a) => {
          return a.year ?? -1 == projectsOfYear[j].year;
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
      switch (projectsOfYear[j].season) {
        case 'Fall':
          const x = categories.findIndex((a) => {
            return a.year == projectsOfYear[j].year;
          });
          if (x != undefined || x != -1) {
            try {
              const y = categories[x].semester.findIndex((a) => {
                return a.season == projectsOfYear[j].season;
              });
              // now since we have the semester, we can attempt to inject the project into it
            } catch (error) {
              // the semester doesnt exist, and is empty, need to create it
            }
          }
          break;
        case 'Summer':
          break;
        case 'Spring':
          break;
      }
    }
    // now since everything is sorted, we can combine to the last datatype
  }

  // broken af
  // for (let i = 0; i < projects.length; i++) {
  //   // find if a category already exists for that year
  //   for (let j = 0; j < categories.length; j++) {
  //     if (categories[j].year == projects[i].year) {
  //       // if the year matches
  //       for (let k = 0; k < categories[j].semester.length; k++) {
  //         if (categories[j].semester[k].season == projects[i].season) {
  //           // if the season exists
  //           categories[j].semester[k].projects = [
  //             ...categories[j].semester[k].projects,
  //             projects[i]
  //           ]; // add the project to that list
  //         } else {
  //           // create that season
  //           categories[j].semester = [
  //             {
  //               season: projects[i].season,
  //               projects: [projects[i]]
  //             }
  //           ];
  //         }
  //       }
  //     } else {
  //       // create that year
  //       categories.push({
  //         year: projects[i].year,
  //         semester: [
  //           {
  //             season: projects[i].season,
  //             projects: [projects[i]]
  //           }
  //         ]
  //       });
  //     }
  //   }
  // }

  // sort by year
  categories.sort((a, b) => {
    return b.year - a.year;
  });
  console.log(categories);
  return { categories };
}) satisfies PageServerLoad;
