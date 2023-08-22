<script lang="ts">
  import '../../app.postcss';
  import '../../theme.postcss';
  import '@skeletonlabs/skeleton/styles/skeleton.css';
  import {
    AppBar,
    AppRail,
    AppRailTile,
    AppShell,
    Avatar,
    LightSwitch
  } from '@skeletonlabs/skeleton';
  import { info } from '../../data/info';
  import SignoutButton from '../../components/buttons/signout-button.svelte';
  import Identicon from 'identicon.js';
  import type { LayoutServerData } from './$types';
  import cybr53 from '../../components/scripts/cybr53';
  export let data: LayoutServerData;
  let currentTile = 0;
</script>

<AppShell>
  <svelte:fragment slot="header">
    <AppBar>
      <svelte:fragment slot="lead">
        <a href="/" class="h1 hover:animate-pulse">{info.mobileTitle}</a>
      </svelte:fragment>
      <svelte:fragment slot="trail">
        <LightSwitch />
        <SignoutButton />
        <Avatar
          src={'data:image/png;base64,' + new Identicon(cybr53(data.fname).toString(), 48)}
          width="w-12"
        />
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
