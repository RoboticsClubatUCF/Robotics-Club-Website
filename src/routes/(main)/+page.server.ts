import numProjects from '../../components/querytools/numbers/numProjects';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async () => {
  let projectCount = await numProjects();
  return { projectCount };
};
