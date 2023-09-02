<script lang="ts">
  import type { Team } from '@prisma/client';

  export let data:
    | (Team & {
        _count: {
          members: number;
        };
      })[]
    | null;
</script>

<div>
  <h2 class="h2">Teams</h2>
  {#if data != null}
    {#each data as team}
      <div class="grid grid-cols-2">
        <h4 class="h4">{team.name}</h4>
        <span class="badge">{team._count.members}</span>
      </div>
    {/each}
  {/if}
</div>
