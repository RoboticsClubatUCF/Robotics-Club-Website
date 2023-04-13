<script>
	import {
		Popover,
		PopoverButton,
		PopoverPanel,
		Tab,
		TabGroup,
		TabList
	} from '@rgossiaux/svelte-headlessui';
	import { onMount } from 'svelte';

	let isMobile = true;
	let windowWidth = 0;
	onMount(() => {
		// if (windowWidth < 500) {
		// 	isMobile = true;
		// } else {
		// 	isMobile = false;
		// }
	});
</script>

<svelte:window bind:innerWidth={windowWidth} />
<nav class="navigation">
	<img src="" alt="icon" srcset="" />
	<div class="mobile-menu">
		{#if isMobile}
			<Popover style="position: relative">
				<PopoverButton class="popover-button">RCCF</PopoverButton>
				<PopoverPanel class="panel">
					<div class="panel-contents">
						<a href="/projects">Projects</a>
						<a href="/history">History</a>
						<a href="/blog">Blog</a>
					</div>
				</PopoverPanel>
			</Popover>
		{/if}
		{#if !isMobile}
			<TabGroup>
				<TabList>
					<Tab>Projects</Tab>
					<Tab>History</Tab>
				</TabList>
			</TabGroup>
		{/if}
	</div>
	<div class="login-signup">
		<a href="/login">Log In</a>
		<a href="/signup">Sign Up</a>
	</div>
</nav>

<style>
	.navigation {
		display: flex;
        
	}
	.mobile-menu {
	}
	.login-signup {
		flex: 1;
	}
	.panel-contents {
		display: grid;
		grid-template-columns: repeat(1, minmax(0, 2fr));
		background-color: rgb(233, 196, 255);
		padding: 1rem;
		border-radius: 7px;
	}
	.panel-contents a {
		font-size: larger;
		text-decoration: none;
		color: black;
		background-color: bisque;
		padding: 0.5rem;
		margin: 0.25rem;
		border-radius: 7px;
	}
	.panel-contents a:hover {
		background-color: rgb(161, 115, 60);
	}
</style>
