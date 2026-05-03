<script lang="ts">
  import type { Prisma, Season } from '@prisma/client';
  import ProjectList from './projectList.svelte';
  import ProjectJoinList from '../rightSidebar/projectJoinList.svelte';

  export let projects: Prisma.ProjectGetPayload<{ include: { logo: true } }>[] | undefined | null;
  export let joinableProjects: Prisma.ProjectGetPayload<{ include: { logo: true } }>[] | undefined | null;
  export let currentYear: number;
  export let currentSemester: Season;
</script>

<div class="h-full card mt-4 mx-2 mb-2 p-4">
  <ProjectList data={projects} {currentYear} {currentSemester} />
  <br />
  <hr class="!border-t-4" />
  <br />
  <ProjectJoinList data={joinableProjects} {currentYear} {currentSemester} />
</div>
