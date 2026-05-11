<svelte:head>
  <title>History @ RCCF</title>
</svelte:head>

<script lang="ts">
  import type { PageData } from './$types';
  export let data: PageData;

  type TimelineItem = { date: string; title: string; description: string };

  let items: TimelineItem[] = [...data.items];
  let editingIndex: number | null = null;
  let editDate = '';
  let editTitle = '';
  let editDescription = '';
  let saving = false;
  let saveError = '';

  async function saveAll(updated: TimelineItem[]) {
    saving = true;
    saveError = '';
    try {
      const res = await fetch('/api/site-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'history.items', value: JSON.stringify(updated), type: 'text' })
      });
      if (!res.ok) saveError = 'Save failed.';
    } catch {
      saveError = 'Network error.';
    } finally {
      saving = false;
    }
  }

  function startEdit(i: number) {
    editingIndex = i;
    editDate = items[i].date;
    editTitle = items[i].title;
    editDescription = items[i].description;
  }

  async function saveItem(i: number) {
    const updated = [...items];
    updated[i] = { date: editDate, title: editTitle, description: editDescription };
    await saveAll(updated);
    if (!saveError) {
      items = updated;
      editingIndex = null;
    }
  }

  async function deleteItem(i: number) {
    if (!confirm('Delete this timeline entry?')) return;
    const updated = items.filter((_, idx) => idx !== i);
    await saveAll(updated);
    if (!saveError) items = updated;
  }

  async function addItem() {
    const updated = [...items, { date: 'Month Year', title: 'New Event', description: 'Description here.' }];
    await saveAll(updated);
    if (!saveError) {
      items = updated;
      startEdit(updated.length - 1);
    }
  }
</script>

<div class="p-4 m-4">
  {#if data.editMode}
    <div class="mb-4 flex items-center justify-between">
      <h2 class="h3">Club History</h2>
      <button on:click={addItem} disabled={saving} class="btn btn-sm variant-ghost-success">
        + Add Event
      </button>
    </div>
    {#if saveError}<p class="text-error-500 text-sm mb-2">{saveError}</p>{/if}

    <div class="space-y-3">
      {#each items as item, i (i)}
        {#if editingIndex === i}
          <div class="card p-4 border-2 border-warning-500 space-y-2">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label class="label">
                <span class="text-xs font-bold">Date</span>
                <input type="text" bind:value={editDate} class="input" placeholder="e.g. March 2022" />
              </label>
              <label class="label">
                <span class="text-xs font-bold">Title</span>
                <input type="text" bind:value={editTitle} class="input" placeholder="Event title" />
              </label>
            </div>
            <label class="label">
              <span class="text-xs font-bold">Description</span>
              <textarea bind:value={editDescription} class="textarea text-sm" rows="3" />
            </label>
            <div class="flex gap-2">
              <button on:click={() => saveItem(i)} disabled={saving} class="btn btn-sm variant-filled-success">
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button on:click={() => (editingIndex = null)} class="btn btn-sm variant-ghost">Cancel</button>
            </div>
          </div>
        {:else}
          <div class="card p-3 flex items-start justify-between gap-2">
            <div class="flex-1 min-w-0">
              <p class="text-xs opacity-50 font-mono">{item.date}</p>
              <p class="font-semibold">{item.title}</p>
              <p class="text-sm opacity-60 line-clamp-2">{item.description}</p>
            </div>
            <div class="flex gap-1 shrink-0">
              <button on:click={() => startEdit(i)} class="btn btn-sm variant-filled-warning">Edit</button>
              <button on:click={() => deleteItem(i)} class="btn btn-sm variant-filled-error" title="Delete">×</button>
            </div>
          </div>
        {/if}
      {/each}
    </div>
  {:else}
    <!-- View mode: classic timeline -->
    <ol class="relative border-l border-gray-200 dark:border-gray-700">
      {#each items as item (item.title + item.date)}
        <li class="mb-10 ml-4">
          <div
            class="absolute w-3 h-3 bg-gray-200 rounded-full mt-1.5 -left-1.5 border border-white dark:border-gray-900 dark:bg-gray-700"
          />
          <time class="mb-1 text-sm font-normal leading-none text-gray-400 dark:text-gray-500">
            {item.date}
          </time>
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white">{item.title}</h3>
          <p class="text-base font-normal text-gray-500 dark:text-gray-400">{item.description}</p>
        </li>
      {/each}
    </ol>
  {/if}
</div>
