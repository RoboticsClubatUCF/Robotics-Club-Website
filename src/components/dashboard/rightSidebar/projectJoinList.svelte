<script lang="ts">
  import type { Prisma } from '@prisma/client';
  import MiniJoinProjectCard from './miniJoinProjectCard.svelte';
  import semesterYear from '../../scripts/semesterYear';

  export let data: Prisma.ProjectGetPayload<{ include: { logo: true } }>[] | null | undefined;

  const { year, semester } = semesterYear();
  $: joinableProjects = (data ?? []).filter((p) => p.year === year && p.season === semester);
</script>

<div>
  <h2 class="h2">Join</h2>
  {#each joinableProjects as project}
    <MiniJoinProjectCard data={project} />
  {:else}
    <p class="text-sm opacity-50 mt-2">No projects available to join this semester.</p>
  {/each}
</div>
