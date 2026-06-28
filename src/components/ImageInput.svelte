<script lang="ts">
  import { parseImageRef, serializeImageRef, imageRefStyle, type Fit, type ImageRef } from '$lib/imageRef';

  // Two-way bound stored string (plain URL/path or JSON envelope).
  export let value: string = '';
  // Tailors the preview frame to how the surface displays the image.
  export let shape: 'avatar' | 'banner' | 'logo' = 'logo';
  export let accept = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';
  export let uploadEndpoint = '/api/upload';
  export let label = 'Image';
  // Fit applied to a legacy/pristine value so its preview matches the display surface.
  export let defaultFit: Fit = 'cover';

  // Local source of truth. Initialized once from `value`; changes are pushed back up.
  let ref: ImageRef = parseImageRef(value);
  if (!(value && value.startsWith('{'))) ref.fit = defaultFit;
  let mode: 'link' | 'upload' = ref.upload || ref.src.startsWith('/uploads/') ? 'upload' : 'link';

  let uploading = false;
  let uploadError = '';
  let dragOver = false;
  let fileInput: HTMLInputElement;
  let previewEl: HTMLDivElement;

  // Only push back to the bound value once the user actually edits, so simply opening an
  // editor over a legacy plain-URL value doesn't rewrite it into an envelope.
  let touched = false;
  $: if (touched) value = serializeImageRef(ref);
  function edited() {
    touched = true;
    ref = ref;
  }

  const FITS: Fit[] = ['cover', 'contain', 'fill'];

  const FRAME: Record<typeof shape, string> = {
    avatar: 'rounded-full aspect-square w-32',
    banner: 'aspect-[21/9] w-full max-w-sm',
    logo: 'aspect-square w-32'
  };

  function setFit(f: Fit) {
    ref.fit = f;
    edited();
  }

  function setScale(e: Event) {
    ref.scale = parseFloat((e.target as HTMLInputElement).value);
    edited();
  }

  function setLink(e: Event) {
    ref.src = (e.target as HTMLInputElement).value.trim();
    ref.upload = undefined;
    edited();
  }

  async function uploadFile(file: File) {
    uploading = true;
    uploadError = '';
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(uploadEndpoint, { method: 'POST', body: fd });
      if (!res.ok) {
        uploadError = (await res.text()) || 'Upload failed.';
        return;
      }
      const { storageKey, url } = await res.json();
      ref.src = url;
      ref.upload = storageKey;
      edited();
    } catch {
      uploadError = 'Network error during upload.';
    } finally {
      uploading = false;
    }
  }

  function onFilePicked(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) uploadFile(file);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) uploadFile(file);
  }

  // Drag the focal point: click/drag anywhere on the preview to set object-position.
  let draggingFocal = false;
  function focalFromEvent(e: PointerEvent) {
    if (!previewEl) return;
    const r = previewEl.getBoundingClientRect();
    ref.focalX = Math.min(100, Math.max(0, Math.round(((e.clientX - r.left) / r.width) * 100)));
    ref.focalY = Math.min(100, Math.max(0, Math.round(((e.clientY - r.top) / r.height) * 100)));
    edited();
  }
  function startFocal(e: PointerEvent) {
    if (!ref.src || ref.fit === 'fill') return;
    draggingFocal = true;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    focalFromEvent(e);
  }
  function moveFocal(e: PointerEvent) {
    if (draggingFocal) focalFromEvent(e);
  }
  function endFocal() {
    draggingFocal = false;
  }

  $: showFocal = !!ref.src && ref.fit !== 'fill';
</script>

<div class="flex flex-col gap-2">
  <div class="flex items-center justify-between">
    <span class="text-sm font-semibold">{label}</span>
    <div class="btn-group variant-soft text-xs">
      <button
        type="button"
        class={mode === 'link' ? 'variant-filled-primary' : ''}
        on:click={() => (mode = 'link')}>Link</button
      >
      <button
        type="button"
        class={mode === 'upload' ? 'variant-filled-primary' : ''}
        on:click={() => (mode = 'upload')}>Upload</button
      >
    </div>
  </div>

  {#if mode === 'link'}
    <input
      type="url"
      value={ref.upload ? '' : ref.src}
      on:input={setLink}
      placeholder="https://example.com/image.png"
      pattern="https://.+"
      class="input p-2 text-sm"
    />
  {:else}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      role="button"
      tabindex="0"
      class="flex flex-col items-center justify-center gap-1 p-4 border-2 border-dashed rounded cursor-pointer text-xs text-center transition-colors {dragOver
        ? 'border-primary-500 bg-primary-500/10'
        : 'border-surface-400'}"
      on:click={() => fileInput.click()}
      on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInput.click()}
      on:dragover|preventDefault={() => (dragOver = true)}
      on:dragleave={() => (dragOver = false)}
      on:drop={onDrop}
    >
      {#if uploading}
        <span>Uploading…</span>
      {:else}
        <span class="font-semibold">Drop an image or click to choose</span>
        <span class="opacity-60">PNG, JPEG, WEBP, GIF, SVG · max 5 MB</span>
      {/if}
    </div>
    <input bind:this={fileInput} type="file" {accept} on:change={onFilePicked} class="hidden" />
    {#if uploadError}
      <p class="text-error-400 text-xs">{uploadError}</p>
    {/if}
  {/if}

  {#if ref.src}
    <div class="flex flex-wrap gap-4 items-start pt-1">
      <!-- Live preview framed exactly as the surface will display it -->
      <div class="flex flex-col items-center gap-1">
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          bind:this={previewEl}
          class="relative overflow-hidden bg-surface-300-600-token {FRAME[shape]} {showFocal
            ? 'cursor-crosshair'
            : ''}"
          on:pointerdown={startFocal}
          on:pointermove={moveFocal}
          on:pointerup={endFocal}
        >
          <img src={ref.src} alt="" class="w-full h-full pointer-events-none" style={imageRefStyle(ref)} />
          {#if showFocal}
            <div
              class="absolute w-3 h-3 rounded-full border-2 border-white bg-primary-500 shadow -translate-x-1/2 -translate-y-1/2 pointer-events-none"
              style="left:{ref.focalX}%; top:{ref.focalY}%;"
            ></div>
          {/if}
        </div>
        {#if showFocal}
          <span class="text-[10px] opacity-60">Click/drag to set focal point</span>
        {/if}
      </div>

      <!-- Adjustment controls -->
      <div class="flex flex-col gap-2 text-xs min-w-[10rem]">
        <div>
          <span class="font-semibold">Fit</span>
          <div class="btn-group variant-soft text-xs mt-1">
            {#each FITS as f}
              <button
                type="button"
                class={ref.fit === f ? 'variant-filled-primary' : ''}
                on:click={() => setFit(f)}>{f}</button
              >
            {/each}
          </div>
        </div>
        <label class="flex flex-col gap-1">
          <span class="font-semibold">Zoom · {ref.scale.toFixed(2)}×</span>
          <input type="range" min="1" max="3" step="0.05" value={ref.scale} on:input={setScale} />
        </label>
      </div>
    </div>
  {/if}
</div>
