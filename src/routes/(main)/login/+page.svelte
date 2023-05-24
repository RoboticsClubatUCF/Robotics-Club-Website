<script lang="ts">
	import SignupButton from '../../../components/buttons/signup-button.svelte';
	import type { PageData } from './$types';
	import { superForm } from 'sveltekit-superforms/client';

	export let data: PageData;

	const { form, errors, constraints } = superForm(data.form);
</script>

<!-- Form that provides a login screen, followed by the option to create your own account -->
<div class="h-screen grid place-items-center absolute w-screen top-0 pointer-events-none">
	<div class="block card p-4 m-8 pointer-events-auto">
		<form method="POST" class="variant-filled-surface p-2 rounded-md">
			<label class="label m-4">
				<span>Email</span>
				<input
					type="email"
					name="email"
					id="email"
					class="input"
					bind:value={$form.email}
					{...$constraints.email}
					required
				/>
				{#if $errors.email}
					<span class="variant-filled-error badge">{$errors.email}</span>
				{/if}
			</label>
			<label class="label m-4">
				<span>Password</span>
				<input
					type="password"
					name="password"
					id="password"
					class="input"
					bind:value={$form.password}
					{...$constraints.password}
					required
				/>
				{#if $errors.password}
					<span class="variant-filled-error badge">{$errors.password}</span>
				{/if}
			</label>
			<button class="btn variant-soft-primary m-4 hover:variant-filled-primary">Log In</button>
			<br />
			<div class="m-4">
				<span class="h3 mr-2">Dont have an account?</span>
				<SignupButton />
			</div>
		</form>
	</div>
</div>
