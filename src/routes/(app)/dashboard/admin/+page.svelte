<script lang="ts">
  import { enhance } from '$app/forms';
  import type { Member, Role } from '@prisma/client';
  import FaUsers from 'svelte-icons/fa/FaUsers.svelte';
  import FaSearch from 'svelte-icons/fa/FaSearch.svelte';

  type MemberWithRoles = Member & { role: Role; roles: Role[] };

  export let data: {
    members: MemberWithRoles[];
    roles: Role[];
    viewerLevel: number;
  };

  export let form: { memberId?: string; error?: string; success?: boolean; discordSynced?: boolean } | null = null;
  export let params: Record<string, string>;

  const MANAGEABLE_ORDER = ['officer', 'lead', 'team lead', 'member'];

  function assignableRoles(roles: Role[]): Role[] {
    const managed = MANAGEABLE_ORDER
      .map((name) => roles.find((r) => r.name === name))
      .filter((r): r is Role => r !== undefined);
    if (data.viewerLevel >= 999) return managed;
    if (data.viewerLevel >= 10)  return managed.filter((r) => r.name !== 'officer');
    if (data.viewerLevel >= 8)   return managed.filter((r) => r.name === 'team lead');
    return [];
  }

  const ROLE_LABELS: Record<string, string> = {
    admin: 'Admin',
    officer: 'Officer',
    lead: 'Project Lead',
    'team lead': 'Team Lead',
    committee: 'Committee',
    member: 'Member',
    guest: 'Guest'
  };

  function roleLabel(name: string) {
    return ROLE_LABELS[name] ?? name;
  }

  function badgeClass(level: number) {
    if (level >= 999) return 'badge variant-filled-error';
    if (level >= 10)  return 'badge variant-filled-warning';
    if (level >= 8)   return 'badge variant-filled-tertiary';
    if (level >= 7)   return 'badge variant-filled-secondary';
    if (level >= 4)   return 'badge variant-filled-success';
    return 'badge variant-ghost';
  }

  function displayRoles(member: MemberWithRoles): Role[] {
    return member.roles.length > 0 ? member.roles : [member.role];
  }

  function handleMutualExclusion(event: Event) {
    const cb = event.target as HTMLInputElement;
    if (!cb.checked) return;
    const formEl = cb.closest('form')!;
    if (cb.value === 'lead') {
      const other = formEl.querySelector<HTMLInputElement>('input[value="team lead"]');
      if (other) other.checked = false;
    } else if (cb.value === 'team lead') {
      const other = formEl.querySelector<HTMLInputElement>('input[value="lead"]');
      if (other) other.checked = false;
    }
  }

  let search = '';
  $: filtered = data.members.filter((m: MemberWithRoles) => {
    const q = search.toLowerCase();
    return (
      m.firstName.toLowerCase().includes(q) ||
      (m.lastName ?? '').toLowerCase().includes(q) ||
      m.email.toLowerCase().includes(q)
    );
  });

  $: assignable = assignableRoles(data.roles);

  const viewerLabel =
    data.viewerLevel >= 999 ? 'Admin' :
    data.viewerLevel >= 10  ? 'Officer' :
    data.viewerLevel >= 8   ? 'Project Lead' : '';
</script>

<div class="p-6 space-y-6">

  <!-- Header -->
  <div class="flex items-center gap-3">
    <div class="w-7 h-7 opacity-60 shrink-0"><FaUsers /></div>
    <div>
      <h1 class="h1">Manage Roles</h1>
      <p class="text-sm opacity-50 mt-0.5">
        {viewerLabel} view —
        {#if assignable.length === 0}
          read-only.
        {:else}
          assignable: {assignable.map((r) => roleLabel(r.name)).join(', ')}.
        {/if}
      </p>
    </div>
  </div>

  <!-- Search -->
  <div class="relative max-w-sm">
    <div class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-40 pointer-events-none">
      <FaSearch />
    </div>
    <input
      type="search"
      bind:value={search}
      placeholder="Search by name or email…"
      class="input pl-9 w-full"
    />
  </div>

  <!-- Table -->
  <div class="table-container overflow-x-auto">
    <table class="table table-hover min-w-[600px]">
      <thead>
        <tr>
          <th>Name</th>
          <th class="hidden sm:table-cell">Email</th>
          <th class="hidden md:table-cell">Discord</th>
          <th>Current Roles</th>
          {#if assignable.length > 0}<th>Assign Roles</th>{/if}
        </tr>
      </thead>
      <tbody>
        {#each filtered as member (member.id)}
          {@const effective = displayRoles(member)}
          <tr>
            <td class="font-medium whitespace-nowrap">{member.firstName} {member.lastName ?? ''}</td>
            <td class="text-sm opacity-60 hidden sm:table-cell max-w-[160px] truncate">{member.email}</td>
            <td class="text-sm opacity-60 hidden md:table-cell">{member.discordProfileName}</td>
            <td>
              <div class="flex flex-wrap gap-1">
                {#each effective as r}
                  <span class={badgeClass(r.permissionLevel)}>{roleLabel(r.name)}</span>
                {/each}
              </div>
            </td>
            {#if assignable.length > 0}
              <td>
                <form
                  method="POST"
                  action="?/updateRoles"
                  use:enhance
                  on:change={handleMutualExclusion}
                  class="space-y-2"
                >
                  <input type="hidden" name="memberId" value={member.id} />
                  <div class="flex flex-wrap gap-x-4 gap-y-1">
                    {#each assignable as role}
                      <label class="flex items-center gap-1.5 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          name="role"
                          value={role.name}
                          checked={effective.some((r) => r.name === role.name)}
                          class="checkbox"
                        />
                        {roleLabel(role.name)}
                      </label>
                    {/each}
                  </div>
                  <div class="flex items-center gap-2">
                    <button type="submit" class="btn btn-sm variant-filled-warning">Apply</button>
                    {#if form?.memberId === member.id && form?.success}
                      <span class="text-xs text-success-500">
                        Saved{form.discordSynced ? ' & synced' : ''}
                      </span>
                    {/if}
                  </div>
                  {#if form?.memberId === member.id && form?.error}
                    <p class="text-xs text-error-500">{form.error}</p>
                  {/if}
                </form>
              </td>
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  {#if filtered.length === 0}
    <p class="text-center opacity-40 py-10">No members match your search.</p>
  {/if}

</div>
