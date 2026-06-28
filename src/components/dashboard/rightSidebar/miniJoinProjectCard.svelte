<script lang="ts">
  import { enhance } from '$app/forms';
  import type { Prisma } from '@prisma/client';
  import { getToastStore, type ToastSettings } from '@skeletonlabs/skeleton';
  import AdjustableImage from '../../AdjustableImage.svelte';
  import { pictureToValue } from '$lib/imageRef';

  export let data: Prisma.ProjectGetPayload<{ include: { logo: true } }>;

  const t: ToastSettings = {
    message: 'You joined ' + data.title,
    background: 'variant-filled-success'
  };
  const toastStore = getToastStore();
</script>

<div class="card grid grid-cols-3 gap-4 mt-2 items-center">
  <a href="/projects/{data.id}" class="col-span-2 flex items-center gap-2 p-2 hover:opacity-75">
    {#if data.logo}
      <AdjustableImage value={pictureToValue(data.logo)} alt="" frameClass="h-10 w-10 rounded-lg shrink-0" defaultFit="cover" />
    {/if}
    <span class="h4">{data.title}</span>
  </a>
  <form action="?/joinProject" method="post" use:enhance={() => async ({ update }) => {
      toastStore.trigger(t);
      await update();
    }}>
    <input type="hidden" name="projectID" value={data.id} />
    <button class="btn variant-ghost-secondary hover:variant-filled-secondary float-right m-2" type="submit">
      Join
    </button>
  </form>
</div>
