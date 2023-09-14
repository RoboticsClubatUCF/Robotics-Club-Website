<script lang="ts">
  import type { Project, Picture, Team } from '@prisma/client';
  import ProjectJoinList from './projectJoinList.svelte';

  export let projects: (Project & { logo: Picture })[] | null;
</script>

<div class="h-full card m-2 p-4">
  <ProjectJoinList data={projects} />
</div>
