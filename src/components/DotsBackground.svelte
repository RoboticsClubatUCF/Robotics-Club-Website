<script lang="ts">
  import { modeCurrent } from '@skeletonlabs/skeleton';
  import { onMount, onDestroy } from 'svelte';
  import { injectDotsBackground } from './pixijs/dotsAnimation';

  let el: HTMLElement;
  let cleanup: (() => void) | null = null;

  function sync() {
    if (!el) return;
    if (!$modeCurrent && !cleanup) {
      cleanup = injectDotsBackground(el);
    } else if ($modeCurrent && cleanup) {
      cleanup();
      cleanup = null;
    }
  }

  onMount(sync);

  $: $modeCurrent, el && sync();

  onDestroy(() => cleanup?.());
</script>

<div bind:this={el} class="absolute inset-0 overflow-hidden pointer-events-none" style="z-index: -10;"></div>
