<script lang="ts">
  import { enhance } from '$app/forms';
  import type { Picture, Project } from '@prisma/client';
  import { getToastStore, type ToastSettings } from '@skeletonlabs/skeleton';

  export let data: Project & { logo: Picture };
  const t: ToastSettings = {
    message: 'You Joined ' + data.title,
    // Provide any utility or variant background style:
    background: 'variant-filled-success'
  };
  let toastStore = getToastStore();
</script>

<div class="card grid grid-cols-3 gap-4">
  <div>
    <!-- icon -->
    {#if data.logo.isLocal}
      <!-- load the image using the b64 method -->
    {:else}
      <img class="h-10 rounded-lg object-cover overflow-hidden m-2" src={data.logo.data} alt="" />
    {/if}
  </div>
  <span class="h4 mt-3">{data.title}</span>
  <form action="?/joinProject" method="post" use:enhance>
    <input type="hidden" readonly name="projectID" id="projectID" bind:value={data.id} />
    <button
      class="btn variant-ghost-secondary hover:variant-filled-secondary float-right m-2"
      type="submit"
      on:click={() => {
        toastStore.trigger(t);
      }}>Join</button
    >
  </form>
</div>
