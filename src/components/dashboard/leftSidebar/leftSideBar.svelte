<script lang="ts">
  import type { Prisma } from '@prisma/client';
  import ProjectList from './projectList.svelte';
  import ProjectJoinList from '../rightSidebar/projectJoinList.svelte';

  export let projects: Prisma.ProjectGetPayload<{ include: { logo: true } }>[] | undefined | null;
  export let joinableProjects: Prisma.ProjectGetPayload<{ include: { logo: true } }>[] | undefined | null;
</script>

<div class="h-full card mt-4 mx-2 mb-2 p-4">
  <ProjectList data={projects} />
  <br />
  <hr class="!border-t-4" />
  <br />
  <ProjectJoinList data={joinableProjects} />
</div>
