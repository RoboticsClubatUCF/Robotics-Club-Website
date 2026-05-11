<script lang="ts">
  import { Toast, Modal, initializeStores } from '@skeletonlabs/skeleton';
  initializeStores();
</script>

<Modal buttonPositive="variant-filled-error" />
<Toast />
<slot />
