<script lang="ts">
  // @ts-ignore
  import '../app.postcss';
  import { page } from '$app/stores';
  import DotsBackground from '../components/DotsBackground.svelte';

  const titles: Record<number, string> = {
    400: 'Malformed Signal',
    401: 'Clearance Required',
    403: 'Access Denied',
    404: 'Component Missing',
    405: 'Invalid Command',
    408: 'Signal Timeout',
    410: 'Unit Decommissioned',
    413: 'Payload Overload',
    429: 'Throttle Limit',
    500: 'System Failure',
    502: 'Relay Failure',
    503: 'System Offline',
    504: 'Upstream Timeout',
  };

  $: status = $page.status;
  $: title = titles[status] ?? 'Unknown Error';
  $: message = $page.error?.message ?? 'An unexpected error occurred in the control system.';
</script>

<div class="relative w-screen h-screen overflow-hidden flex items-center justify-center p-4">
  <DotsBackground></DotsBackground>

  <div class="card overflow-hidden max-w-lg w-full">
    <div class="p-10 flex flex-col items-center gap-4 text-center">
      <h1 class="h1" style="color: rgb(var(--color-primary-400));">{status}</h1>

      <p class="font-bold uppercase tracking-widest text-sm" style="color: rgb(var(--color-secondary-400));">
        {title}
      </p>

      <div class="w-12 h-0.5" style="background: rgb(var(--color-primary-400));"></div>

      <p class="opacity-70 text-sm leading-relaxed max-w-sm">{message}</p>

      <div class="flex gap-3 flex-wrap justify-center mt-2">
        {#if status === 401 || status === 403}
          <a href="/login" class="btn variant-filled-primary font-bold">Sign In</a>
          <a href="/" class="btn variant-ghost-primary font-bold">Return Home</a>

        {:else if status === 400 || status === 413}
          <button class="btn variant-ghost-primary font-bold" on:click={() => history.back()}>Go Back</button>
          <a href="/" class="btn variant-filled-primary font-bold">Return Home</a>

        {:else if status === 408 || status === 425 || status === 429}
          <button class="btn variant-filled-primary font-bold" on:click={() => location.reload()}>Try Again</button>
          <a href="/" class="btn variant-ghost-primary font-bold">Return Home</a>

        {:else if status === 500 || status === 502 || status === 503 || status === 504}
          <button class="btn variant-filled-primary font-bold" on:click={() => location.reload()}>Try Again</button>
          <a href="https://discord.gg/m8XZahpNjR" target="_blank" rel="noopener noreferrer" class="btn variant-ghost-primary font-bold">Notify Officers</a>

        {:else if status === 501}
          <a href="/" class="btn variant-filled-primary font-bold">Return Home</a>
          <a href="https://discord.gg/m8XZahpNjR" target="_blank" rel="noopener noreferrer" class="btn variant-ghost-primary font-bold">Notify Officers</a>

        {:else}
          <a href="/" class="btn variant-filled-primary font-bold">Return Home</a>
        {/if}
      </div>
    </div>
  </div>
</div>
