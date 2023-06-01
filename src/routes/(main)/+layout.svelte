<script>
  import '../../app.postcss';
  import '../../theme.postcss';
  import '@skeletonlabs/skeleton/styles/skeleton.css';
  import { AppBar, AppShell, Tab, TabGroup } from '@skeletonlabs/skeleton';
  import { info } from '../../data/info';
  import SigninButton from '../../components/buttons/signin-button.svelte';
  import LoadHandler from '../../components/loadHandler.svelte';
</script>

<LoadHandler />
<AppShell>
  <svelte:fragment slot="pageHeader">
    <AppBar>
      <svelte:fragment slot="lead">
        <a href="/" class="h1 hover:animate-pulse">{info.title}</a>
      </svelte:fragment>
      <svelte:fragment slot="trail"><SigninButton /></svelte:fragment>
    </AppBar>
  </svelte:fragment>
  <slot />
</AppShell>
