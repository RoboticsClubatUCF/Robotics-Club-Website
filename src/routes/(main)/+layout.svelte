<script lang="ts" src="../../../node_modules/flowbite/dist/flowbite.min.js">
  import '../../app.postcss';
  import { AppBar, AppShell, LightSwitch } from '@skeletonlabs/skeleton';
  import { page } from '$app/stores';
  import { info } from '../../data/info';
  import LoadHandler from '../../components/loadHandler.svelte';
  import Navigation from '../../components/navigation.svelte';
  import SigninButton from '../../components/buttons/signin-button.svelte';
  import type { LayoutServerData } from './$types';
  import DashboardButton from '../../components/buttons/dashboard-button.svelte';
  export let data: LayoutServerData;

  $: currentPath = $page.url.pathname;
</script>

<LoadHandler />
<AppShell>
  <svelte:fragment slot="pageHeader">
    {#if data.editMode}
      <div class="w-full bg-warning-500 text-white flex items-center justify-between px-4 py-2 gap-4 z-50">
        <div class="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
          </svg>
          <span class="font-bold text-sm">Edit Mode Active</span>
          <span class="text-xs opacity-80">— Hover over content and click to edit. Changes save immediately.</span>
        </div>
        <a
          href="/api/edit-mode?enable=false&to={encodeURIComponent(currentPath)}"
          class="btn btn-sm variant-filled-surface text-white border border-white/30 hover:bg-white/20"
        >
          Exit Edit Mode
        </a>
      </div>
    {/if}
    <AppBar>
      <svelte:fragment slot="lead">
        <a href="/" class="h1 hover:animate-pulse">{info.title}</a>
      </svelte:fragment>
      <svelte:fragment slot="headline"><Navigation /></svelte:fragment>
      <svelte:fragment slot="trail">
        <LightSwitch />
        {#if data.user}
          <DashboardButton />
        {:else}
          <SigninButton />
        {/if}
      </svelte:fragment>
    </AppBar>
  </svelte:fragment>
  <slot />
</AppShell>
