<script lang="ts">
	import { injectDotsBackground } from '$lib/dots-animation';

	let { isDark }: { isDark: boolean } = $props();

	$effect(() => {
		if (!isDark) return;
		return injectDotsBackground();
	});
</script>
