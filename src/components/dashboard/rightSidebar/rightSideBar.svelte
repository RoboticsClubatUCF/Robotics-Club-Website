<script lang="ts">
  import type { Prisma } from '@prisma/client';
  import ProjectJoinList from './projectJoinList.svelte';

  export let projects: Prisma.ProjectGetPayload<{ include: { logo: true } }>[] | null | undefined;
</script>

<div class="h-full card m-2 p-4">
  <ProjectJoinList data={projects} />
</div>
