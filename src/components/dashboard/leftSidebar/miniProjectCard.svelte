<script lang="ts">
  import type { Prisma } from '@prisma/client';

  export let data: Prisma.ProjectGetPayload<{ include: { logo: true } }>;
</script>

<a href="/projects/{data.id}" class="card grid grid-cols-3 mt-2 items-center gap-3 p-2 hover:card-hover">
  <div>
    <!-- icon -->
    {#if data.logo?.isLocal}
      <!-- load the image using the b64 method -->
    {:else if data.logo}
      <img class="h-12 rounded-lg object-cover overflow-hidden" src={data.logo.data} alt="" />
    {/if}
  </div>
  <span class="h4 col-span-2">{data.title}</span>
</a>
