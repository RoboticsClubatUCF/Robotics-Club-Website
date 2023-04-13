<script>
	import NewNav from '../components/newNav.svelte';
</script>

<div>
	<NewNav />
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
