<script lang="ts">
  import type { Picture, Project } from '@prisma/client';

  export let data: Project & { logo: Picture };
</script>

<div class="card grid grid-cols-3 mt-2">
  <div>
    <!-- icon -->
    {#if data.logo.isLocal}
      <!-- load the image using the b64 method -->
    {:else}
      <img class="h-12 rounded-lg object-cover overflow-hidden" src={data.logo.data} alt="" />
    {/if}
  </div>
  <span class="h4">{data.title}</span>
</div>
