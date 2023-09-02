<script lang="ts" src="../../../node_modules/flowbite/dist/flowbite.min.js">
  import '../../app.postcss';
  import '../../theme.postcss';
  import '@skeletonlabs/skeleton/styles/skeleton.css';
  import { AppBar, AppShell, LightSwitch, Tab, TabGroup } from '@skeletonlabs/skeleton';
  import { info } from '../../data/info';
  import LoadHandler from '../../components/loadHandler.svelte';
  import Navigation from '../../components/navigation.svelte';
  import SigninButton from '../../components/buttons/signin-button.svelte';
  import type { LayoutServerData } from './$types';
  import DashboardButton from '../../components/buttons/dashboard-button.svelte';
  export let data: LayoutServerData;
</script>

<LoadHandler />
<AppShell>
  <svelte:fragment slot="pageHeader">
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
