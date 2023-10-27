<script lang="ts">
  import type { Role } from '@prisma/client';
  import config from '../../../config';

  let role: Role;
</script>

<div class="p-2 m-2">
  <h3 class="h3">Links to other Dashboards</h3>
  {#if role.name == config.roles.officer.name}
    <!-- user is an officer, of what type, we do not know -->

    <!-- make availaible to every officer the following -->
    <a href="/admin" class="btn variant-ghost-tertiary hover:variant-filled-tertiary">Admin</a>

    <a href="/lead" class="btn variant-ghost-tertiary hover:variant-filled-tertiary">Teamlead</a>
  {/if}
  {#if role.name == config.roles.lead.name}
    <!-- user is an officer, of what type, we do not know -->

    <!-- make availaible to every officer the following -->
    <a href="/lead" class="btn variant-ghost-tertiary hover:variant-filled-tertiary">Teamlead</a>
  {/if}
</div>
