<script lang="ts">
  import type { Picture, Project } from '@prisma/client';
  import MiniProjectCard from './miniProjectCard.svelte';

  export let data: (Project & { logo: Picture })[] | null | undefined;
</script>

<div class="">
  <h2 class="h2">Projects</h2>
  {#if data != null}
    {#each data as project}
      <MiniProjectCard data={project} />
    {/each}
  {/if}
</div>
