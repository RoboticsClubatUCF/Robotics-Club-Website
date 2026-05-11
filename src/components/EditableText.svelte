<script lang="ts">
  export let contentKey: string;
  export let value: string;
  export let editMode: boolean = false;
  export let multiline: boolean = true;

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
        body: JSON.stringify({ key: contentKey, value: editValue, type: 'text' })
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

  function startEdit() {
    editValue = value;
    editing = true;
  }

  function cancel() {
    editValue = value;
    editing = false;
    saveError = '';
  }
</script>

{#if editMode && editing}
  <div class="relative w-full">
    {#if multiline}
      <textarea
        bind:value={editValue}
        class="w-full p-2 border-2 border-warning-500 rounded bg-surface-100-800-token resize-y text-sm font-inherit"
        rows="4"
        autofocus
      />
    {:else}
      <input
        type="text"
        bind:value={editValue}
        class="w-full p-2 border-2 border-warning-500 rounded bg-surface-100-800-token text-sm"
        autofocus
      />
    {/if}
    {#if saveError}
      <p class="text-error-500 text-xs mt-1">{saveError}</p>
    {/if}
    <div class="flex gap-2 mt-1">
      <button
        on:click={save}
        disabled={saving}
        class="btn btn-sm variant-filled-success"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
      <button on:click={cancel} class="btn btn-sm variant-ghost">Cancel</button>
    </div>
  </div>
{:else if editMode}
  <div
    class="relative group cursor-pointer rounded outline-dashed outline-2 outline-warning-500/50 hover:outline-warning-500 transition-all p-1"
    on:click={startEdit}
    role="button"
    tabindex="0"
    on:keydown={(e) => { if (e.key === 'Enter') startEdit(); }}
    title="Click to edit"
  >
    <span class="absolute -top-5 right-0 bg-warning-500 text-white text-xs px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
      Click to edit
    </span>
    {value}
  </div>
{:else}
  {value}
{/if}
