<script lang="ts">
  import { modeCurrent } from '@skeletonlabs/skeleton';
  import type { PageData } from './$types';
  export let data: PageData;
  export let params: { slug: string };
</script>

<div class="grid place-items-center min-h-[80vh] p-6">
  <div class={$modeCurrent
    ? 'card p-8 shadow-xl shadow-surface-300 w-full max-w-lg text-center'
    : 'card p-8 shadow-xl shadow-surface-500 w-full max-w-lg text-center'}>

    <h1 class="h1 mb-2">Welcome to RCCF, {data.firstName}!</h1>
    <p class="opacity-60 mb-4">Your membership is now active.</p>

    <!-- Membership status callout -->
    <div class="membership-card mb-6">
      <div class="membership-row">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="status-icon" aria-hidden="true">
          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd"/>
        </svg>
        <div>
          <p class="membership-label">Membership Active</p>
          <p class="membership-sub">Expires {data.membershipExpDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
        </div>
      </div>
      <hr class="membership-divider" />
      <div class="membership-row">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="discord-icon" class:discord-ok={data.discordSynced} aria-hidden="true">
          <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zm0 16a3 3 0 01-2.83-2h5.66A3 3 0 0110 18z"/>
        </svg>
        <div>
          {#if data.discordSynced}
            <p class="membership-label">Discord Role Assigned</p>
            <p class="membership-sub">Your member role has been applied in Discord</p>
          {:else}
            <p class="membership-label">Discord Role Pending</p>
            <p class="membership-sub">Make sure your Discord username in your profile is correct, then update it to sync</p>
          {/if}
        </div>
      </div>
    </div>

    <!-- Next steps -->
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8 text-left">

      <a href="/projects" class="card variant-soft-surface p-4 hover:variant-soft-primary transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-6 h-6 mb-2 opacity-70" aria-hidden="true">
          <path d="M11.644 1.59a.75.75 0 01.712 0l9.75 5.25a.75.75 0 010 1.32l-9.75 5.25a.75.75 0 01-.712 0l-9.75-5.25a.75.75 0 010-1.32l9.75-5.25z" />
          <path d="M3.265 10.602l7.668 4.129a2.25 2.25 0 002.134 0l7.668-4.13 1.37.739a.75.75 0 010 1.32l-9.75 5.25a.75.75 0 01-.71 0l-9.75-5.25a.75.75 0 010-1.32l1.37-.738z" />
          <path d="M10.933 19.231l-7.668-4.13-1.37.739a.75.75 0 000 1.32l9.75 5.25c.221.12.489.12.71 0l9.75-5.25a.75.75 0 000-1.32l-1.37-.738-7.668 4.13a2.25 2.25 0 01-2.134-.001z" />
        </svg>
        <p class="font-semibold text-sm mb-1">Browse Projects</p>
        <p class="text-xs opacity-50">Find a team and start building</p>
      </a>

      <a href="/dashboard" class="card variant-soft-surface p-4 hover:variant-soft-primary transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-6 h-6 mb-2 opacity-70" aria-hidden="true">
          <path d="M11.47 3.841a.75.75 0 011.06 0l8.69 8.69a.75.75 0 101.06-1.061l-8.689-8.69a2.25 2.25 0 00-3.182 0l-8.69 8.69a.75.75 0 101.061 1.06l8.69-8.689z" />
          <path d="M12 5.432l8.159 8.159c.03.03.06.058.091.086v6.198c0 1.035-.84 1.875-1.875 1.875H15a.75.75 0 01-.75-.75v-4.5a.75.75 0 00-.75-.75h-3a.75.75 0 00-.75.75V21a.75.75 0 01-.75.75H5.625a1.875 1.875 0 01-1.875-1.875v-6.198a2.29 2.29 0 00.091-.086L12 5.432z" />
        </svg>
        <p class="font-semibold text-sm mb-1">Your Dashboard</p>
        <p class="text-xs opacity-50">View your projects, teams, and profile</p>
      </a>

    </div>

  </div>
</div>

<style>
  .membership-card {
    border: 1px solid rgba(0, 0, 0, 0.35);
    border-radius: 0.75rem;
    padding: 1rem 1.25rem;
    text-align: left;
    background: rgba(0, 0, 0, 0.35);
  }

  .membership-row {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .membership-divider {
    border-color: rgba(255, 255, 255, 0.08);
    margin: 0.875rem 0;
  }

  .status-icon {
    width: 1.25rem;
    height: 1.25rem;
    color: #22c55e;
    flex-shrink: 0;
    margin-top: 0.1rem;
  }

  .discord-icon {
    width: 1.25rem;
    height: 1.25rem;
    color: #a5b4fc;
    flex-shrink: 0;
    margin-top: 0.1rem;
  }

  .discord-ok {
    color: #22c55e;
  }

  .membership-label {
    font-size: 0.875rem;
    font-weight: 600;
    line-height: 1.3;
  }

  .membership-sub {
    font-size: 0.75rem;
    opacity: 0.5;
    margin-top: 0.1rem;
    line-height: 1.4;
  }
</style>
