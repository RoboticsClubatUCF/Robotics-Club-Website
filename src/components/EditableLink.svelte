<script lang="ts">
  export let contentKey: string;
  export let href: string;
  export let editMode: boolean = false;
  export let linkClass: string = '';
  export let external: boolean = true;

  let editing = false;
  let editValue = href;
  let saving = false;
  let saveError = '';

  async function save() {
    saving = true;
    saveError = '';
    try {
      const res = await fetch('/api/site-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: contentKey, value: editValue, type: 'text' })
      });
      if (res.ok) {
        href = editValue;
        editing = false;
      } else {
        saveError = 'Save failed.';
      }
    } catch {
      saveError = 'Network error.';
    } finally {
      saving = false;
    }
  }

  function cancel() {
    editValue = href;
    editing = false;
    saveError = '';
  }
</script>

{#if editMode && editing}
  <div class="relative w-full flex flex-col gap-1 my-1">
    <p class="text-xs opacity-60">Link URL for: <code>{contentKey}</code></p>
    <!-- svelte-ignore a11y_autofocus -->
    <input
      type="text"
      bind:value={editValue}
      class="w-full p-2 border-2 border-warning-500 rounded bg-surface-100-800-token text-sm"
      placeholder="https://…"
      autofocus
    />
    {#if saveError}<p class="text-error-500 text-xs">{saveError}</p>{/if}
    <div class="flex gap-2">
      <button on:click={save} disabled={saving} class="btn btn-sm variant-filled-success">
        {saving ? 'Saving…' : 'Save URL'}
      </button>
      <button on:click={cancel} class="btn btn-sm variant-ghost">Cancel</button>
    </div>
  </div>
{:else}
  <span class="relative group inline-flex items-center gap-1">
    <a
      href={href}
      class={linkClass}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
    >
      <slot />
    </a>
    {#if editMode}
      <button
        on:click={() => { editValue = href; editing = true; }}
        class="btn btn-sm variant-filled-warning opacity-0 group-hover:opacity-100 transition-opacity text-xs px-1 py-0 leading-none"
        title="Edit link URL"
      >
        ✎ URL
      </button>
    {/if}
  </span>
{/if}
