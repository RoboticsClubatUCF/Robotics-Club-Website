<script src="../../../node_modules/flowbite/dist/flowbite.min.js">
  import '../../app.postcss';
  import '../../theme.postcss';
  import '@skeletonlabs/skeleton/styles/skeleton.css';
  import { AppBar, AppShell, LightSwitch, Tab, TabGroup } from '@skeletonlabs/skeleton';
  import { info } from '../../data/info';
  import LoadHandler from '../../components/loadHandler.svelte';
  import Navigation from '../../components/navigation.svelte';
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
        <!-- <SigninButton /> -->
      </svelte:fragment>
    </AppBar>
  </svelte:fragment>
  <slot />
</AppShell>
