<script lang="ts">
  import { parseImageRef, imageRefStyle, type Fit } from '$lib/imageRef';

  // Stored image string: a plain URL/path or a JSON envelope (see $lib/imageRef).
  export let value: string | null | undefined = '';
  export let alt = '';
  // Sizing/shape for the frame (e.g. 'w-full aspect-video rounded-md' or 'rounded-full aspect-square').
  export let frameClass = '';
  // Shown when there's no image (e.g. a robohash avatar or a default /photos/*.png).
  export let fallback: string | null = null;
  export let imgClass = '';
  // Fit to use for legacy/pristine values that carry no explicit adjustment (e.g. 'contain' for logos).
  export let defaultFit: Fit | undefined = undefined;

  $: ref = (() => {
    const r = parseImageRef(value);
    if (defaultFit && !(value && value.startsWith('{'))) r.fit = defaultFit;
    return r;
  })();
  $: src = ref.src || fallback;
</script>

{#if src}
  <div class="overflow-hidden {frameClass}">
    <img {src} {alt} class="w-full h-full {imgClass}" style={imageRefStyle(ref)} />
  </div>
{/if}
