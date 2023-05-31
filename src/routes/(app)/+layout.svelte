<script>
  import { AppBar, AppRail, AppRailTile, AppShell } from '@skeletonlabs/skeleton';
  import { info } from '../../data/info';
  import { page } from '$app/stores';
  let currentTile = 0;
</script>

<AppShell>
  <svelte:fragment slot="header">
    <AppBar>
      <svelte:fragment slot="lead">
        <a href="/" class="h1 hover:animate-pulse">{info.mobileTitle}</a>
      </svelte:fragment>
      <svelte:fragment slot="trail">
        <!-- put user pfp and username -->
      </svelte:fragment>
    </AppBar>
  </svelte:fragment>
  <svelte:fragment slot="sidebarLeft">
    <!-- Hidden below Tailwind's large breakpoint -->
    <div id="sidebar-left" class="hidden lg:block">
      <AppRail>
        <!-- add page links -->
        <!-- use app rail tiles to add links -->
      </AppRail>
    </div>
  </svelte:fragment>
  <slot />
</AppShell>
