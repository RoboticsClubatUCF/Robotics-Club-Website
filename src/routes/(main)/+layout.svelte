<script lang="ts" src="../../../node_modules/flowbite/dist/flowbite.min.js">
  import '../../app.postcss';
  import { AppBar, AppShell } from '@skeletonlabs/skeleton';
  import { page } from '$app/stores';
  import { info } from '../../data/info';
  import LoadHandler from '../../components/loadHandler.svelte';
  import Navigation from '../../components/navigation.svelte';
  import SigninButton from '../../components/buttons/signin-button.svelte';
  import type { LayoutServerData } from './$types';
  import DashboardButton from '../../components/buttons/dashboard-button.svelte';
  export let data: LayoutServerData;

  $: currentPath = $page.url.pathname;

  let menuOpen = false;
  function toggleMenu() { menuOpen = !menuOpen; }
  function closeMenu() { menuOpen = false; }
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
        <a href="/" class="h1 whitespace-nowrap">
          <span class="sm:hidden">{info.mobileTitle}</span>
          <span class="hidden sm:inline">{info.title}</span>
        </a>
      </svelte:fragment>
      <svelte:fragment slot="headline">
        <!-- Desktop nav only -->
        <div class="hidden sm:block">
          <Navigation />
        </div>
      </svelte:fragment>
      <svelte:fragment slot="trail">
        <!-- Desktop: auth button only -->
        <div class="hidden sm:flex items-center gap-2">
          {#if data.user}
            <DashboardButton />
          {:else}
            <SigninButton />
          {/if}
        </div>

        <!-- Mobile: hamburger opens from top-right -->
        <div class="sm:hidden relative">
          <button
            class="btn variant-ghost-surface p-2"
            on:click={toggleMenu}
            aria-label="Toggle navigation"
            aria-expanded={menuOpen}
          >
            {#if menuOpen}
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            {:else}
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            {/if}
          </button>

          {#if menuOpen}
            <button
              class="fixed inset-0 z-40 bg-transparent cursor-default"
              on:click={closeMenu}
              tabindex="-1"
              aria-label="Close menu"
            />
            <nav class="absolute right-0 top-full mt-1 z-50 card shadow-xl p-2 min-w-[160px] space-y-1">
              <a href="/" on:click={closeMenu} class="btn w-full variant-ghost hover:variant-filled-primary justify-start">Home</a>
              <a href="/projects" on:click={closeMenu} class="btn w-full variant-ghost hover:variant-filled-primary justify-start">Projects</a>
              <a href="/sponsors" on:click={closeMenu} class="btn w-full variant-ghost hover:variant-filled-primary justify-start">Sponsors</a>
              <a href="/outreach" on:click={closeMenu} class="btn w-full variant-ghost hover:variant-filled-primary justify-start">Outreach</a>
              <a
                href="http://secretlibrary.rccf.club"
                target="_blank"
                rel="noopener noreferrer"
                on:click={closeMenu}
                class="btn w-full variant-ghost hover:variant-filled-primary justify-start"
              >Library ↗</a>
              <hr class="opacity-20" />
              {#if data.user}
                <a href="/dashboard" on:click={closeMenu} class="btn w-full variant-ghost-primary hover:variant-filled-primary justify-start">Dashboard</a>
              {:else}
                <a href="/login" on:click={closeMenu} class="btn w-full variant-ghost-primary hover:variant-filled-primary justify-start">Sign In</a>
              {/if}
            </nav>
          {/if}
        </div>
      </svelte:fragment>
    </AppBar>
  </svelte:fragment>
  <slot />
</AppShell>
