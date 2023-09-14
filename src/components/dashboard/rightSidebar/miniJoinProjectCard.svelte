<script lang="ts">
  import { enhance } from '$app/forms';
  import type { Picture, Project } from '@prisma/client';

  export let data: Project & { logo: Picture };
</script>

<div class="card grid grid-cols-3 gap-4">
  <div>
    <!-- icon -->
    {#if data.logo.isLocal}
      <!-- load the image using the b64 method -->
    {:else}
      <img class="h-12 rounded-lg object-cover overflow-hidden" src={data.logo.data} alt="" />
    {/if}
  </div>
  <span class="h4">{data.title}</span>
  <form action="?/joinProject" method="post" use:enhance>
    <input type="hidden" readonly name="projectID" id="projectID" bind:value={data.id} />
    <button class="btn variant-ghost-secondary hover:variant-filled-secondary" type="submit"
      >Join</button
    >
  </form>
</div>
