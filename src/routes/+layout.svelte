<script lang="ts">
  import { Toast, initializeStores } from '@skeletonlabs/skeleton';
  initializeStores();
  export let params: Record<string, string>;
</script>

<Toast />
<slot />
