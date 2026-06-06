<script lang="ts">
  import { Toast, Modal, initializeStores } from '@skeletonlabs/skeleton';
  import { beforeNavigate } from '$app/navigation';

  initializeStores();

  const CHALLENGED_ROUTES = ['/register', '/forgotPass'];

  beforeNavigate(({ to, cancel }) => {
    if (to && CHALLENGED_ROUTES.some((r) => to.url.pathname.startsWith(r))) {
      cancel();
      window.location.href = to.url.href;
    }
  });
</script>

<Modal buttonPositive="variant-filled-error" />
<Toast />
<slot />
