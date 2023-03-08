<script>
	import { info } from '../data/info';
	import Device from 'svelte-device-info';
	import { onMount } from 'svelte';
	var isMobile = false;
	onMount(() => {
		isMobile = Device.isMobile;
	});
</script>

<div class="navigation">
	{#if isMobile}
		<h1 class="title"><a href="/">{info.mobileTitle}</a></h1>
	{:else}
		<h1 class="title"><a href="/">{info.title}</a></h1>
	{/if}
	{#each info.nav.buttons as item}
		<div class="button">
			<a href={item.link}>{item.name}</a>
		</div>
	{/each}
	<div class="line" />
</div>

<style>
	@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Montserrat:wght@400;600;700&display=swap');
	.navigation {
		display: flex;
		font-family: 'Montserrat', sans-serif;
		font-weight: 600;
		background-color: #002333;
		height: 78px;
		width: 100vw;
		position: absolute;
		top: 0px;
		left: 0px;
	}
	.line {
		width: 100vw;
		position: absolute;
		top: 78px;
		left: 0px;
		height: 3px;
		background-color: #e6dc84;
	}
	.title {
		flex: 2;
		color: #f2f2f2;
		height: inherit;
		width: 629px;
		font-size: 36px;
	}
	.button {
		flex: 1;
		color: #f2f2f2;
		font-size: 36px;
		height: 78px;
		width: 222px;
		margin-top: 15px;
		text-align: center;
		vertical-align: middle;
		text-decoration: none;
		font-weight: 400;
	}
	a {
		text-decoration: inherit;
		color: inherit;
		text-align: inherit;
		vertical-align: inherit;
		text-decoration: inherit;
		font-weight: inherit;
		font: inherit;
	}
	a:hover {
		color: #e6dc84;
		font-weight: 700;
	}
</style>
