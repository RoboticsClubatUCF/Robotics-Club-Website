<script lang="ts">
  import type { Prisma, Season } from '@prisma/client';
  import MiniProjectCard from './miniProjectCard.svelte';

  export let data: Prisma.ProjectGetPayload<{ include: { logo: true } }>[] | null | undefined;
  export let currentYear: number;
  export let currentSemester: Season;
</script>

<div>
  <h2 class="h2">Projects</h2>
  <p class="text-xs opacity-50 mb-2">{currentSemester} {currentYear}</p>
  {#each (data ?? []) as project}
    <MiniProjectCard data={project} />
  {:else}
    <p class="text-sm opacity-50 mt-2">No projects this semester.</p>
  {/each}
</div>
