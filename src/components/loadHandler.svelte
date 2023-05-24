<script>
	import { ProgressRadial } from '@skeletonlabs/skeleton';
	import { onMount } from 'svelte';
	let loading = true;
	onMount(() => {
		loading = false;
	});
</script>

{#if loading}
	<div class="absolute grid h-screen w-screen place-content-center">
		<ProgressRadial meter="stroke-primary-500" track="stroke-primary-500/30" />
	</div>
{/if}
