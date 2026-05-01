<script lang="ts">
  import { enhance } from '$app/forms';
  import { modeCurrent } from '@skeletonlabs/skeleton';
  import type { PageData, ActionData } from './$types';

  export let data: PageData;
  export let form: ActionData;

  type Project = typeof data.projects[number];

  // ---- Edit state ----
  let editingId: number | null = null;
  let editTitle = '';
  let editDescription = '';
  let editLogo = '';
  let editDocsLink = '';
  let editSeason = 'Fall';
  let editYear = '';
  let editSkills = '';
  let editDiscordRoleId = '';

  function startEdit(p: Project) {
    editingId = p.id;
    editTitle = p.title;
    editDescription = p.description;
    editLogo = p.logo?.data ?? '';
    editDocsLink = p.docsLink;
    editSeason = p.season;
    editYear = String(p.year);
    editSkills = (p.Skills ?? []).join(', ');
    editDiscordRoleId = (p as any).discordRoleId ?? '1111111';
  }

  function cancelEdit() {
    editingId = null;
  }

  // ---- Create state ----
  let showCreate = false;
  let creating = false;
  let deleting: number | null = null;
  let duplicating: number | null = null;
  let saving = false;

  const SEASONS = ['Fall', 'Spring', 'Summer'];
</script>

<div class="p-6 max-w-4xl mx-auto space-y-6">
  <div class="flex items-center justify-between">
    <h2 class="h2">Manage Projects</h2>
    <button
      on:click={() => { showCreate = !showCreate; editingId = null; }}
      class="btn variant-ghost-success hover:variant-filled-success"
    >
      {showCreate ? 'Cancel' : '+ New Project'}
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
      <h3 class="h4">Create New Project</h3>
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
            <span class="text-xs font-bold">Title *</span>
            <input type="text" name="title" class="input" placeholder="Project title" required />
          </label>
          <label class="label">
            <span class="text-xs font-bold">Season *</span>
            <select name="season" class="select" required>
              {#each SEASONS as s}<option value={s}>{s}</option>{/each}
            </select>
          </label>
        </div>
        <label class="label">
          <span class="text-xs font-bold">Description</span>
          <textarea name="description" class="textarea" rows="2" placeholder="Optional description" />
        </label>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label class="label">
            <span class="text-xs font-bold">Logo Image URL *</span>
            <input type="url" name="logo" class="input" placeholder="https://…" required />
          </label>
          <label class="label">
            <span class="text-xs font-bold">Documentation URL *</span>
            <input type="url" name="docsLink" class="input" placeholder="https://…" required />
          </label>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label class="label">
            <span class="text-xs font-bold">Year *</span>
            <input type="number" name="year" class="input" placeholder={String(new Date().getFullYear())} required />
          </label>
          <label class="label">
            <span class="text-xs font-bold">Skills (comma-separated)</span>
            <input type="text" name="Skills" class="input" placeholder="Python, CAD, Welding" />
          </label>
        </div>
        <label class="label">
          <span class="text-xs font-bold">Discord Role ID</span>
          <input type="text" name="discordRoleId" class="input" placeholder="Leave blank for no Discord role" />
        </label>
        <div class="flex gap-2">
          <button type="submit" disabled={creating} class="btn variant-filled-success">
            {creating ? 'Creating…' : 'Create'}
          </button>
          <button type="button" on:click={() => (showCreate = false)} class="btn variant-ghost">Cancel</button>
        </div>
      </form>
    </div>
  {/if}

  <!-- Project list -->
  {#if data.projects.length === 0}
    <p class="opacity-50 text-sm italic">No projects yet. Create one above.</p>
  {:else}
    <div class="space-y-3">
      {#each data.projects as project (project.id)}
        {#if editingId === project.id}
          <!-- Inline edit form -->
          <div class={$modeCurrent
            ? 'card p-5 border-2 border-warning-500 shadow-xl shadow-surface-300 space-y-3'
            : 'card p-5 border-2 border-warning-500 shadow-xl shadow-surface-500 space-y-3'}>
            <h3 class="h5">Editing: {project.title}</h3>
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
              <input type="hidden" name="id" value={project.id} />
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label class="label">
                  <span class="text-xs font-bold">Title *</span>
                  <input type="text" name="title" class="input" bind:value={editTitle} required />
                </label>
                <label class="label">
                  <span class="text-xs font-bold">Season *</span>
                  <select name="season" class="select" bind:value={editSeason}>
                    {#each SEASONS as s}<option value={s}>{s}</option>{/each}
                  </select>
                </label>
              </div>
              <label class="label">
                <span class="text-xs font-bold">Description</span>
                <textarea name="description" class="textarea" rows="2" bind:value={editDescription} />
              </label>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label class="label">
                  <span class="text-xs font-bold">Logo Image URL</span>
                  <input type="url" name="logo" class="input" bind:value={editLogo} placeholder="https://…" />
                </label>
                <label class="label">
                  <span class="text-xs font-bold">Documentation URL</span>
                  <input type="url" name="docsLink" class="input" bind:value={editDocsLink} placeholder="https://…" />
                </label>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label class="label">
                  <span class="text-xs font-bold">Year *</span>
                  <input type="number" name="year" class="input" bind:value={editYear} required />
                </label>
                <label class="label">
                  <span class="text-xs font-bold">Skills (comma-separated)</span>
                  <input type="text" name="Skills" class="input" bind:value={editSkills} />
                </label>
              </div>
              <label class="label">
                <span class="text-xs font-bold">Discord Role ID</span>
                <input type="text" name="discordRoleId" class="input" bind:value={editDiscordRoleId} placeholder="Leave blank for no Discord role" />
              </label>
              {#if editLogo}
                <img src={editLogo} alt="Preview" class="h-12 object-contain rounded" />
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
          <!-- Project card -->
          <div class={$modeCurrent
            ? 'card p-4 flex items-center gap-4 shadow-surface-300'
            : 'card p-4 flex items-center gap-4 shadow-surface-500'}>
            {#if project.logo?.data}
              <img src={project.logo.data} alt={project.title} class="h-12 w-12 object-contain shrink-0 rounded" />
            {:else}
              <div class="h-12 w-12 bg-surface-300-600-token rounded shrink-0" />
            {/if}
            <div class="flex-1 min-w-0">
              <p class="font-semibold">{project.title}</p>
              <p class="text-xs opacity-50">{project.season} {project.year}</p>
              {#if project.Skills?.length}
                <p class="text-xs opacity-40">{project.Skills.join(', ')}</p>
              {/if}
            </div>
            <div class="flex flex-wrap gap-2 shrink-0">
              <button
                on:click={() => startEdit(project)}
                class="btn btn-sm variant-filled-warning"
              >Edit</button>
              <form
                method="POST"
                action="?/duplicate"
                use:enhance={() => {
                  duplicating = project.id;
                  return async ({ update }) => {
                    await update();
                    duplicating = null;
                  };
                }}
              >
                <input type="hidden" name="id" value={project.id} />
                <button
                  type="submit"
                  disabled={duplicating === project.id}
                  class="btn btn-sm variant-filled-secondary"
                  title="Duplicate for current semester"
                >
                  {duplicating === project.id ? '…' : 'Duplicate'}
                </button>
              </form>
              <form
                method="POST"
                action="?/delete"
                use:enhance={({ cancel }) => {
                  if (!confirm(`Delete "${project.title}"? This will also remove its articles.`)) {
                    cancel();
                    return;
                  }
                  deleting = project.id;
                  return async ({ update }) => {
                    await update();
                    deleting = null;
                  };
                }}
              >
                <input type="hidden" name="id" value={project.id} />
                <button
                  type="submit"
                  disabled={deleting === project.id}
                  class="btn btn-sm variant-filled-error"
                  title="Delete project"
                >
                  {deleting === project.id ? '…' : '×'}
                </button>
              </form>
            </div>
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</div>
