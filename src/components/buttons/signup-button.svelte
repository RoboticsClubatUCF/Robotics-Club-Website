<script>
	export let mobile = false;
</script>

{#if mobile}
	<a href="/register" type="button" class="btn variant-filled-secondary">Sign Up</a>
{:else}
	<a href="/register" type="button" class="btn variant-filled-secondary">Become a Member</a>
{/if}
