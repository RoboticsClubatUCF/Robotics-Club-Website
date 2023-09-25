<script lang="ts">
  import { Toast, initializeStores } from '@skeletonlabs/skeleton';
  import { autoModeWatcher } from '@skeletonlabs/skeleton';
  initializeStores();
</script>

<Toast />
<svelte:head
  >{@html `<script>${autoModeWatcher.toString()} autoModeWatcher();</script>`}</svelte:head
>
<slot />
