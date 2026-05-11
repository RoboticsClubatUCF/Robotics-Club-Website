<script lang="ts">
  type Officer = {
    id: string;
    firstName: string;
    lastName: string | null;
    position: string | null;
    bio: string | null;
    profileLink: string | null;
    profilePictureUrl: string | null;
    role: { name: string; permissionLevel: number };
  };

  export let officers: Officer[] = [];
  export let editMode: boolean = false;

  let editingId: string | null = null;
  let editFields: { position: string; bio: string; profileLink: string; profilePictureUrl: string } = {
    position: '',
    bio: '',
    profileLink: '',
    profilePictureUrl: ''
  };
  let saving = false;
  let saveError = '';

  let dragging: string | null = null;
  let dragOver: string | null = null;

  function handleDragStart(e: DragEvent, id: string) {
    if (!editMode) { e.preventDefault(); return; }
    dragging = id;
    e.dataTransfer!.effectAllowed = 'move';
  }

  function handleDragOver(e: DragEvent, id: string) {
    if (!editMode || !dragging) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    dragOver = id;
  }

  function handleDrop(e: DragEvent, targetId: string) {
    e.preventDefault();
    if (!editMode || !dragging || dragging === targetId) {
      dragging = null;
      dragOver = null;
      return;
    }
    const fromIdx = officers.findIndex((o) => o.id === dragging);
    const toIdx = officers.findIndex((o) => o.id === targetId);
    const reordered = [...officers];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    officers = reordered;
    dragging = null;
    dragOver = null;
    saveOrder(reordered.map((o) => o.id));
  }

  function handleDragEnd() {
    dragging = null;
    dragOver = null;
  }

  async function saveOrder(ids: string[]) {
    await fetch('/api/site-content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'home.officers.order', value: JSON.stringify(ids), type: 'json' })
    });
  }

  function startEdit(officer: Officer) {
    editingId = officer.id;
    editFields = {
      position: officer.position ?? '',
      bio: officer.bio ?? '',
      profileLink: officer.profileLink ?? '',
      profilePictureUrl: officer.profilePictureUrl ?? ''
    };
  }

  function cancelEdit() {
    editingId = null;
    saveError = '';
  }

  async function saveOfficer(officer: Officer) {
    saving = true;
    saveError = '';
    if (editFields.profileLink && !editFields.profileLink.startsWith('https://')) {
      saveError = 'Profile link must start with https://';
      saving = false;
      return;
    }
    if (editFields.profilePictureUrl && !editFields.profilePictureUrl.startsWith('https://')) {
      saveError = 'Photo URL must start with https://';
      saving = false;
      return;
    }
    try {
      const res = await fetch(`/api/members/${officer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editFields)
      });
      if (res.ok) {
        officer.position = editFields.position || null;
        officer.bio = editFields.bio || null;
        officer.profileLink = editFields.profileLink || null;
        officer.profilePictureUrl = editFields.profilePictureUrl || null;
        officers = [...officers];
        editingId = null;
      } else {
        saveError = 'Save failed.';
      }
    } catch {
      saveError = 'Network error.';
    } finally {
      saving = false;
    }
  }
</script>

<div class="grid grid-cols-1 md:grid-cols-4 gap-4 w-full mt-8">
  {#each officers as officer (officer.id)}
    <div
      draggable={editMode && editingId !== officer.id}
      class="relative transition-opacity {dragging === officer.id ? 'opacity-40' : 'opacity-100'} {dragOver === officer.id && dragging !== officer.id ? 'ring-2 ring-warning-500 rounded-container-token' : ''}"
      on:dragstart={(e) => handleDragStart(e, officer.id)}
      on:dragover={(e) => handleDragOver(e, officer.id)}
      on:drop={(e) => handleDrop(e, officer.id)}
      on:dragend={handleDragEnd}
    >
      {#if editMode && editingId === officer.id}
        <div class="card overflow-hidden border-2 border-warning-500 p-4 space-y-2">
          <p class="font-bold text-sm">{officer.firstName} {officer.lastName ?? ''}</p>
          <label class="label">
            <span class="text-xs">Title / Position</span>
            <input type="text" bind:value={editFields.position} class="input input-sm" placeholder="e.g. President" />
          </label>
          <label class="label">
            <span class="text-xs">Bio</span>
            <textarea bind:value={editFields.bio} class="textarea text-sm" rows="3" placeholder="Short description…"></textarea>
          </label>
          <label class="label">
            <span class="text-xs">Profile Link (LinkedIn, etc.)</span>
            <input type="url" bind:value={editFields.profileLink} class="input input-sm" placeholder="https://…" pattern="https://.+" title="Must be a full URL starting with https://" />
          </label>
          <label class="label">
            <span class="text-xs">Photo URL</span>
            <input type="url" bind:value={editFields.profilePictureUrl} class="input input-sm" placeholder="https://…/photo.jpg" pattern="https://.+" title="Must be a full URL starting with https://" />
          </label>
          {#if editFields.profilePictureUrl}
            <img src={editFields.profilePictureUrl} alt="Preview" class="w-16 h-16 rounded-full object-cover" />
          {/if}
          {#if saveError}<p class="text-error-500 text-xs">{saveError}</p>{/if}
          <div class="flex gap-2">
            <button on:click={() => saveOfficer(officer)} disabled={saving} class="btn btn-sm variant-filled-success">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button on:click={cancelEdit} class="btn btn-sm variant-ghost">Cancel</button>
          </div>
        </div>
      {:else}
        <div class="relative group h-full">
          {#if editMode}
            <div class="absolute top-2 left-2 z-10 bg-black/60 text-white rounded p-1 cursor-grab pointer-events-none" title="Drag to reorder">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M7 2a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm6-12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0z"/>
              </svg>
            </div>
          {/if}
          <a
            class="card card-hover overflow-hidden block"
            href={officer.profileLink ?? '#'}
            target={officer.profileLink ? '_blank' : undefined}
            rel="noopener noreferrer"
          >
            <div class="bg-surface-200-700-token w-full aspect-[10/8] flex items-center justify-center overflow-hidden">
              {#if officer.profilePictureUrl}
                <img
                  src={officer.profilePictureUrl}
                  alt="{officer.firstName} {officer.lastName ?? ''}"
                  class="w-full h-full object-cover"
                />
              {:else}
                <span class="text-4xl font-bold opacity-30">
                  {officer.firstName[0]}{officer.lastName?.[0] ?? ''}
                </span>
              {/if}
            </div>
            <div class="p-4 space-y-1">
              <h6 class="h3">{officer.firstName} {officer.lastName ?? ''}</h6>
              {#if officer.position}
                <p class="text-sm opacity-70">{officer.position}</p>
              {:else}
                <p class="text-sm opacity-40 italic">{officer.role.name}</p>
              {/if}
              {#if officer.bio}
                <p class="text-xs opacity-60 mt-1">{officer.bio}</p>
              {/if}
            </div>
          </a>
          {#if editMode}
            <button
              on:click={() => startEdit(officer)}
              class="absolute top-2 right-2 btn btn-sm variant-filled-warning opacity-0 group-hover:opacity-100 transition-opacity z-10"
            >
              Edit
            </button>
          {/if}
        </div>
      {/if}
    </div>
  {/each}

  {#if officers.length === 0}
    <p class="col-span-4 text-center opacity-50 py-8">No officers found.</p>
  {/if}
</div>
