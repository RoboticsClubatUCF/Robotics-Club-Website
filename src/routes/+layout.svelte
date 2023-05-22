<script>
	import '../app.postcss';
	import '../theme.postcss';
	import '@skeletonlabs/skeleton/styles/skeleton.css';
	import '../app.postcss';
	import { AppBar, AppShell } from '@skeletonlabs/skeleton';
	import { info } from '../data/info';
	import SigninButton from '../components/buttons/signin-button.svelte';
</script>

<AppShell>
	<svelte:fragment slot="pageHeader">
		<AppBar>
			<svelte:fragment slot="lead"><h1 class="h1">{info.title}</h1></svelte:fragment>
			<svelte:fragment slot="trail"><SigninButton /></svelte:fragment>
		</AppBar>
	</svelte:fragment>
	<slot />
</AppShell>
