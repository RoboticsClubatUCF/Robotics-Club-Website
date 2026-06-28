<script lang="ts">
  import type { Prisma } from '@prisma/client';
  import AdjustableImage from '../../AdjustableImage.svelte';
  import { pictureToValue } from '$lib/imageRef';

  export let data: Prisma.ProjectGetPayload<{ include: { logo: true } }>;
</script>

<a href="/projects/{data.id}" class="card grid grid-cols-3 mt-2 items-center gap-3 p-2 hover:card-hover">
  <div>
    <!-- icon -->
    {#if data.logo}
      <AdjustableImage value={pictureToValue(data.logo)} alt="" frameClass="h-12 w-12 rounded-lg" defaultFit="cover" />
    {/if}
  </div>
  <span class="h4 col-span-2">{data.title}</span>
</a>
