<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let loading = $state(false);
</script>

<svelte:head>
	<title>Sign In | RCCF</title>
</svelte:head>

<div class="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center px-4 py-12">
	<div class="mb-6">
		<a href="/" class="btn btn-ghost btn-sm gap-2 text-base-content/60 hover:text-brand-gold">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-4 w-4"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M10 19l-7-7m0 0l7-7m-7 7h18"
				/>
			</svg>
			Back to Home
		</a>
	</div>
	<div class="card w-full max-w-md border border-brand-gold/20 bg-base-100/50 shadow-xl backdrop-blur-sm">
		<div class="card-body">
			<div class="mb-6 text-center">
				<h1 class="text-3xl font-bold tracking-tight text-brand-gold">Welcome Back</h1>
				<p class="mt-2 text-sm text-base-content/60">Enter your credentials to access your dashboard</p>
			</div>

			<form
				method="POST"
				use:enhance={() => {
					loading = true;
					return async ({ update }) => {
						await update();
						loading = false;
					};
				}}
				class="space-y-4"
			>
				{#if form?.error}
					<div class="alert alert-error text-sm">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-6 w-6 shrink-0 stroke-current"
							fill="none"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
						<span>{form.error}</span>
					</div>
				{/if}

				<div class="form-control">
					<label class="label" for="discordUserName">
						<span class="label-text font-medium">Discord Username</span>
					</label>
					<input
						type="text"
						id="discordUserName"
						name="discordUserName"
						placeholder="phibiscool"
						class="input input-bordered w-full focus:border-brand-gold focus:outline-none"
						required
						autocomplete="username"
					/>
				</div>

				<div class="form-control">
					<label class="label" for="password">
						<span class="label-text font-medium">Password</span>
						<a href="/forgot-password" class="label-text-alt link link-hover text-brand-gold">
							Forgot?
						</a>
					</label>
					<input
						type="password"
						id="password"
						name="password"
						placeholder="••••••••"
						class="input input-bordered w-full focus:border-brand-gold focus:outline-none"
						required
						autocomplete="current-password"
					/>
				</div>

				<div class="mt-6">
					<button type="submit" class="btn btn-warning w-full" disabled={loading}>
						{#if loading}
							<span class="loading loading-spinner loading-sm"></span>
						{/if}
						Sign In
					</button>
				</div>
			</form>

			<div class="mt-8 text-center text-sm">
				<span class="text-base-content/60">Don't have an account?</span>
				<a href="/signup" class="ml-1 font-semibold text-brand-gold hover:underline">
					Join Us
				</a>
			</div>
		</div>
	</div>
</div>
