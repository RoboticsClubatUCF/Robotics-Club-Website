<script lang="ts">
  import type { Picture, Project } from '@prisma/client';
  import MiniJoinProjectCard from './miniJoinProjectCard.svelte';

  export let data: (Project & { logo: Picture })[] | null | undefined;
</script>

<div class="">
  <h2 class="h2">Join</h2>
  {#if data != null}
    {#each data as project}
      <MiniJoinProjectCard data={project} />
    {/each}
  {/if}
</div>
