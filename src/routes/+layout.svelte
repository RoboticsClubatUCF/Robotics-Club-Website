<script>
	import Background from '../components/background.svelte';
	import Nav from '../components/nav.svelte';
</script>

<div>
	<Nav />
	<div class="page">
		<slot />
	</div>
</div>

<style>
	.page {
		position: absolute;
		top: 80px;
	}
</style>
