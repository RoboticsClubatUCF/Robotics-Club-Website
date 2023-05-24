<script>
	import '../../app.postcss';
	import '../../theme.postcss';
	import '@skeletonlabs/skeleton/styles/skeleton.css';
	import { AppBar, AppShell, Tab, TabGroup } from '@skeletonlabs/skeleton';
	import { info } from '../../data/info';
	import SigninButton from '../../components/buttons/signin-button.svelte';
	import LoadHandler from '../../components/loadHandler.svelte';
	import { layoutTab } from '../../stores';
	$: console.log($layoutTab);
</script>

<LoadHandler />
<AppShell>
	<svelte:fragment slot="pageHeader">
		<AppBar>
			<svelte:fragment slot="lead">
				<a href="/" class="h1 hover:animate-pulse">{info.title}</a>
			</svelte:fragment>
			<TabGroup justify="justify-center">
				<Tab bind:group={$layoutTab} name="home" value={0}>Home</Tab>
				<Tab bind:group={$layoutTab} name="about" value={1}>About</Tab>
				<Tab bind:group={$layoutTab} name="history" value={2}>History</Tab>
			</TabGroup>
			<svelte:fragment slot="trail"><SigninButton /></svelte:fragment>
		</AppBar>
	</svelte:fragment>
	<slot />
</AppShell>
