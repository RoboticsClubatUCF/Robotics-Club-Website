<script lang="ts">
  import type { Prisma } from '@prisma/client';
  import MiniProjectCard from './miniProjectCard.svelte';

  export let data: Prisma.ProjectGetPayload<{ include: { logo: true } }>[] | null | undefined;
</script>

<div class="">
  <h2 class="h2">Projects</h2>
  {#if data != null}
    {#each data as project}
      <MiniProjectCard data={project} />
    {/each}
  {/if}
</div>
