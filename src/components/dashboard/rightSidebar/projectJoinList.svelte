<script lang="ts">
  import type { Prisma } from '@prisma/client';
  import MiniJoinProjectCard from './miniJoinProjectCard.svelte';

  export let data: Prisma.ProjectGetPayload<{ include: { logo: true } }>[] | null | undefined;
</script>

<div class="">
  <h2 class="h2">Join</h2>
  {#if data != null}
    {#each data as project}
      <MiniJoinProjectCard data={project} />
    {/each}
  {/if}
</div>
