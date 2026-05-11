<script lang="ts">
  import type { Prisma } from '@prisma/client';
  import MiniJoinProjectCard from './miniJoinProjectCard.svelte';

  export let data: Prisma.ProjectGetPayload<{ include: { logo: true } }>[] | null | undefined;
</script>

<div>
  <h2 class="h2">Join</h2>
  {#each (data ?? []) as project}
    <MiniJoinProjectCard data={project} />
  {:else}
    <p class="text-sm opacity-50 mt-2">No projects available to join this semester.</p>
  {/each}
</div>
