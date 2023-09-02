<script lang="ts">
  import { initializeStores } from '@skeletonlabs/skeleton';
  import { autoModeWatcher } from '@skeletonlabs/skeleton';
  initializeStores();
</script>

<svelte:head
  >{@html `<script>${autoModeWatcher.toString()} autoModeWatcher();</script>`}</svelte:head
>
<slot />
