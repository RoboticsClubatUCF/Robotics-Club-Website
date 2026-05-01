<script lang="ts">
  import { enhance } from '$app/forms';
  import { modeCurrent } from '@skeletonlabs/skeleton';
  import type { PageData, ActionData } from './$types';

  export let data: PageData;
  export let form: ActionData;

  type Sponsor = typeof data.sponsors[number];
  type TierKey = 'processor' | 'circuit' | 'bolt' | 'aluminum';
  const TIER_KEYS: TierKey[] = ['processor', 'circuit', 'bolt', 'aluminum'];

  // ---- Edit state ----
  let editingId: number | null = null;
  let editName = '';
  let editImageUrl = '';
  let editLink = '';
  let editTier: TierKey = 'aluminum';

  function startEdit(s: Sponsor) {
    editingId = s.id;
    editName = s.name;
    editImageUrl = s.imageUrl;
    editLink = s.link;
    editTier = s.tier as TierKey;
  }

  function cancelEdit() { editingId = null; }

  function tierLabel(key: string) {
    return data.tiers[key as TierKey];
  }

  // ---- Create state ----
  let showCreate = false;
  let creating = false;
  let saving = false;
  let deleting: number | null = null;
</script>

<div class="p-6 max-w-4xl mx-auto space-y-6">
  <div class="flex items-center justify-between">
    <h2 class="h2">Manage Sponsors</h2>
    <button
      on:click={() => { showCreate = !showCreate; editingId = null; }}
      class="btn variant-ghost-success hover:variant-filled-success"
    >
      {showCreate ? 'Cancel' : '+ New Sponsor'}
    </button>
  </div>

  {#if form?.error}
    <p class="text-error-500 text-sm">{form.error}</p>
  {/if}

  <!-- Create form -->
  {#if showCreate}
    <div class={$modeCurrent
      ? 'card p-5 border-2 border-success-500 shadow-xl shadow-surface-300 space-y-3'
      : 'card p-5 border-2 border-success-500 shadow-xl shadow-surface-500 space-y-3'}>
      <h3 class="h4">Add New Sponsor</h3>
      <form
        method="POST"
        action="?/create"
        use:enhance={() => {
          creating = true;
          return async ({ update }) => {
            await update();
            creating = false;
            showCreate = false;
          };
        }}
        class="space-y-3"
      >
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label class="label">
            <span class="text-xs font-bold">Name *</span>
            <input type="text" name="name" class="input" placeholder="Sponsor name" required />
          </label>
          <label class="label">
            <span class="text-xs font-bold">Tier *</span>
            <select name="tier" class="select" required>
              {#each TIER_KEYS as key}
                <option value={key}>{data.tiers[key].name} — {data.tiers[key].amount}</option>
              {/each}
            </select>
          </label>
        </div>
        <label class="label">
          <span class="text-xs font-bold">Logo Image URL</span>
          <input type="url" name="imageUrl" class="input" placeholder="https://…" />
        </label>
        <label class="label">
          <span class="text-xs font-bold">Website Link</span>
          <input type="url" name="link" class="input" placeholder="https://…" />
        </label>
        <div class="flex gap-2">
          <button type="submit" disabled={creating} class="btn variant-filled-success">
            {creating ? 'Adding…' : 'Add'}
          </button>
          <button type="button" on:click={() => (showCreate = false)} class="btn variant-ghost">Cancel</button>
        </div>
      </form>
    </div>
  {/if}

  <!-- Sponsor list -->
  {#if data.sponsors.length === 0}
    <p class="opacity-50 text-sm italic">No sponsors yet. Add one above.</p>
  {:else}
    <div class="space-y-3">
      {#each data.sponsors as sponsor (sponsor.id)}
        {#if editingId === sponsor.id}
          <div class={$modeCurrent
            ? 'card p-5 border-2 border-warning-500 shadow-xl shadow-surface-300 space-y-3'
            : 'card p-5 border-2 border-warning-500 shadow-xl shadow-surface-500 space-y-3'}>
            <h3 class="h5">Editing: {sponsor.name}</h3>
            <form
              method="POST"
              action="?/update"
              use:enhance={() => {
                saving = true;
                return async ({ update }) => {
                  await update();
                  saving = false;
                  editingId = null;
                };
              }}
              class="space-y-3"
            >
              <input type="hidden" name="id" value={sponsor.id} />
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label class="label">
                  <span class="text-xs font-bold">Name *</span>
                  <input type="text" name="name" class="input" bind:value={editName} required />
                </label>
                <label class="label">
                  <span class="text-xs font-bold">Tier *</span>
                  <select name="tier" class="select" bind:value={editTier}>
                    {#each TIER_KEYS as key}
                      <option value={key}>{data.tiers[key].name} — {data.tiers[key].amount}</option>
                    {/each}
                  </select>
                </label>
              </div>
              <label class="label">
                <span class="text-xs font-bold">Logo Image URL</span>
                <input type="url" name="imageUrl" class="input" bind:value={editImageUrl} placeholder="https://…" />
              </label>
              <label class="label">
                <span class="text-xs font-bold">Website Link</span>
                <input type="url" name="link" class="input" bind:value={editLink} placeholder="https://…" />
              </label>
              {#if editImageUrl}
                <img src={editImageUrl} alt="Preview" class="h-12 object-contain rounded" />
              {/if}
              <div class="flex gap-2">
                <button type="submit" disabled={saving} class="btn variant-filled-warning">
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" on:click={cancelEdit} class="btn variant-ghost">Cancel</button>
              </div>
            </form>
          </div>
        {:else}
          <div class={$modeCurrent
            ? 'card p-4 flex items-center gap-4 shadow-surface-300'
            : 'card p-4 flex items-center gap-4 shadow-surface-500'}>
            {#if sponsor.imageUrl}
              <img src={sponsor.imageUrl} alt={sponsor.name} class="h-12 w-12 object-contain shrink-0 rounded" />
            {:else}
              <div class="h-12 w-12 bg-surface-300-600-token rounded shrink-0" />
            {/if}
            <div class="flex-1 min-w-0">
              <p class="font-semibold">{sponsor.name}</p>
              <p class="text-xs opacity-50">
                {tierLabel(sponsor.tier)?.name} — {tierLabel(sponsor.tier)?.amount}
              </p>
              {#if sponsor.link}
                <a href={sponsor.link} target="_blank" class="text-xs text-primary-500 underline truncate block">{sponsor.link}</a>
              {/if}
            </div>
            <div class="flex gap-2 shrink-0">
              <button on:click={() => startEdit(sponsor)} class="btn btn-sm variant-filled-warning">Edit</button>
              <form
                method="POST"
                action="?/delete"
                use:enhance={({ cancel }) => {
                  if (!confirm(`Remove "${sponsor.name}"?`)) { cancel(); return; }
                  deleting = sponsor.id;
                  return async ({ update }) => {
                    await update();
                    deleting = null;
                  };
                }}
              >
                <input type="hidden" name="id" value={sponsor.id} />
                <button
                  type="submit"
                  disabled={deleting === sponsor.id}
                  class="btn btn-sm variant-filled-error"
                  title="Remove sponsor"
                >
                  {deleting === sponsor.id ? '…' : '×'}
                </button>
              </form>
            </div>
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</div>
