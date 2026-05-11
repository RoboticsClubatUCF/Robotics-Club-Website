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
          <input type="text" bind:value={editFields.profileLink} class="input input-sm" placeholder="https://…" />
        </label>
        <label class="label">
          <span class="text-xs">Photo URL</span>
          <input type="text" bind:value={editFields.profilePictureUrl} class="input input-sm" placeholder="https://…/photo.jpg" />
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
      <div class="relative group">
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
  {/each}

  {#if officers.length === 0}
    <p class="col-span-4 text-center opacity-50 py-8">No officers found.</p>
  {/if}
</div>
