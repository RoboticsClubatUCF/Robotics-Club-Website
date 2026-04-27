<script lang="ts">
  export let contentKey: string;
  export let value: string;
  export let alt: string = '';
  export let editMode: boolean = false;
  export let imgClass: string = '';

  let editing = false;
  let editValue = value;
  let saving = false;
  let saveError = '';

  async function save() {
    saving = true;
    saveError = '';
    try {
      const res = await fetch('/api/site-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: contentKey, value: editValue, type: 'image' })
      });
      if (res.ok) {
        value = editValue;
        editing = false;
      } else {
        saveError = 'Save failed. Try again.';
      }
    } catch {
      saveError = 'Network error.';
    } finally {
      saving = false;
    }
  }

  function cancel() {
    editValue = value;
    editing = false;
    saveError = '';
  }
</script>

<div class="relative group">
  <img src={value} {alt} class={imgClass} />

  {#if editMode}
    {#if editing}
      <div class="absolute inset-0 bg-black/70 flex flex-col items-center justify-center p-4 gap-2 z-10">
        <p class="text-white text-xs font-bold">Image URL or path:</p>
        <input
          type="text"
          bind:value={editValue}
          class="w-full p-2 border-2 border-warning-500 rounded text-sm bg-surface-100-800-token"
          placeholder="/photos/example.png or https://..."
          autofocus
        />
        {#if saveError}
          <p class="text-error-400 text-xs">{saveError}</p>
        {/if}
        <div class="flex gap-2">
          <button on:click={save} disabled={saving} class="btn btn-sm variant-filled-success">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button on:click={cancel} class="btn btn-sm variant-ghost text-white">Cancel</button>
        </div>
      </div>
    {:else}
      <button
        on:click={() => { editValue = value; editing = true; }}
        class="absolute inset-0 opacity-0 group-hover:opacity-100 bg-black/50 flex items-center justify-center transition-opacity z-10 cursor-pointer border-2 border-dashed border-warning-500 rounded"
      >
        <span class="bg-warning-500 text-white text-sm px-3 py-1 rounded font-bold">Change Image</span>
      </button>
    {/if}
  {/if}
</div>
