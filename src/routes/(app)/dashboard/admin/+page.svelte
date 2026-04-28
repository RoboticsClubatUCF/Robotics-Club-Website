<script lang="ts">
  import { enhance } from '$app/forms';
  import type { Member, Role } from '@prisma/client';

  type MemberWithRole = Member & { role: Role };

  export let data: {
    members: MemberWithRole[];
    roles: Role[];
    isAdmin: boolean;
  };

  const LEVEL_LABELS: Record<number, string> = {
    999: 'Admin',
    10: 'Officer',
    8: 'Lead',
    6: 'Committee',
    4: 'Member',
    0: 'Guest'
  };

  function levelLabel(level: number) {
    return LEVEL_LABELS[level] ?? `Level ${level}`;
  }

  function badgeClass(level: number) {
    if (level >= 999) return 'badge variant-filled-error';
    if (level >= 10) return 'badge variant-filled-warning';
    if (level >= 8) return 'badge variant-filled-tertiary';
    if (level >= 6) return 'badge variant-filled-secondary';
    if (level >= 4) return 'badge variant-filled-success';
    return 'badge variant-ghost';
  }

  let search = '';
  $: filtered = data.members.filter((m: MemberWithRole) => {
    const q = search.toLowerCase();
    return (
      m.firstName.toLowerCase().includes(q) ||
      (m.lastName ?? '').toLowerCase().includes(q) ||
      m.email.toLowerCase().includes(q) ||
      m.role.name.toLowerCase().includes(q)
    );
  });
</script>

<div class="m-6 space-y-6">
  <div>
    <h1 class="h1">Role Management</h1>
    <p class="opacity-60 text-sm mt-1">
      {#if data.isAdmin}
        View and change any member's role.
      {:else}
        Officer view — read-only member list.
      {/if}
    </p>
  </div>

  <input
    type="search"
    bind:value={search}
    placeholder="Search by name, email, or role…"
    class="input w-full max-w-md"
  />

  <div class="table-container">
    <table class="table table-hover">
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Discord</th>
          <th>Current Role</th>
          {#if data.isAdmin}<th>Change Role</th>{/if}
        </tr>
      </thead>
      <tbody>
        {#each filtered as member (member.id)}
          <tr>
            <td>{member.firstName} {member.lastName ?? ''}</td>
            <td class="text-sm opacity-70">{member.email}</td>
            <td class="text-sm opacity-70">{member.discordProfileName}</td>
            <td>
              <span class={badgeClass(member.role.permissionLevel)}>
                {levelLabel(member.role.permissionLevel)}
              </span>
            </td>
            {#if data.isAdmin}
              <td>
                <form method="POST" action="?/assignRole" use:enhance class="flex gap-2 items-center">
                  <input type="hidden" name="memberId" value={member.id} />
                  <select name="roleName" class="select select-sm text-sm" value={member.role.name}>
                    {#each data.roles as role}
                      <option value={role.name} selected={role.name === member.role.name}>
                        {levelLabel(role.permissionLevel)} ({role.name})
                      </option>
                    {/each}
                  </select>
                  <button type="submit" class="btn btn-sm variant-filled-warning">Apply</button>
                </form>
              </td>
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  {#if filtered.length === 0}
    <p class="text-center opacity-50 py-8">No members match your search.</p>
  {/if}
</div>
