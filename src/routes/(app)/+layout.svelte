<script lang="ts">
  import '../../app.postcss';
  import {
    AppBar,
    AppRail,
    AppRailTile,
    AppShell,
    Avatar,
    Drawer,
    LightSwitch,
    getDrawerStore,
    type DrawerSettings
  } from '@skeletonlabs/skeleton';
  import { info } from '../../data/info';
  import SignoutButton from '../../components/buttons/signout-button.svelte';
  import Identicon from 'identicon.js';
  import type { LayoutServerData } from './$types';
  import cybr53 from '../../components/scripts/cybr53';
  import LeftSideBar from '../../components/dashboard/leftSidebar/leftSideBar.svelte';
  import BreadCrumbs from '../../components/breadCrumbs.svelte';
  import RightSideBar from '../../components/dashboard/rightSidebar/rightSideBar.svelte';
  import ProfilePic from '../../components/profilePic.svelte';
  export let data: LayoutServerData;

  const drawerStore = getDrawerStore();
  let currentTile = 0;
  $: positionClasses = $drawerStore.open ? 'translate-x-[50%]' : '';
  const drawerSettingsSet: DrawerSettings = { id: 'settings' };
</script>

<Drawer>
  {#if $drawerStore.id == 'dashboard1'}
    <LeftSideBar projects={$drawerStore.meta.projects} teams={$drawerStore.meta.teams} />
  {:else if $drawerStore.id == 'dashboard2'}
    <RightSideBar projects={$drawerStore.meta.projects} />
  {/if}
</Drawer>

<AppShell class="transition-transform {positionClasses}">
  <svelte:fragment slot="header">
    <AppBar>
      <svelte:fragment slot="lead">
        <ol class="h1">{info.mobileTitle}</ol>
        <div class="m-2" />
        <BreadCrumbs />
      </svelte:fragment>
      <svelte:fragment slot="trail">
        <LightSwitch />
        <SignoutButton />
        <a href="/dashboard/profile"> <ProfilePic hash={data.member.id} /></a>
      </svelte:fragment>
    </AppBar>
  </svelte:fragment>

  <slot />
</AppShell>
