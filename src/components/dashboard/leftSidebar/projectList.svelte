<script lang="ts">
  import type { Prisma } from '@prisma/client';
  import MiniProjectCard from './miniProjectCard.svelte';
  import semesterYear from '../../scripts/semesterYear';

  export let data: Prisma.ProjectGetPayload<{ include: { logo: true } }>[] | null | undefined;

  const { year, semester } = semesterYear();
  $: currentProjects = (data ?? []).filter((p) => p.year === year && p.season === semester);
</script>

<div>
  <h2 class="h2">Projects</h2>
  <p class="text-xs opacity-50 mb-2">{semester} {year}</p>
  {#each currentProjects as project}
    <MiniProjectCard data={project} />
  {:else}
    <p class="text-sm opacity-50 mt-2">No projects this semester.</p>
  {/each}
</div>
