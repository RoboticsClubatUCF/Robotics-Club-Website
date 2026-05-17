<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let loading = $state(false);
</script>

<svelte:head>
	<title>Forgot Password | RCCF</title>
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
				<h1 class="text-3xl font-bold tracking-tight text-brand-gold">Reset Password</h1>
				<p class="mt-2 text-sm text-base-content/60">Enter your email to receive a reset link</p>
			</div>

			{#if form?.success}
				<div class="alert alert-success text-sm">
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
							d="M9 12l2 2l4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
						/>
					</svg>
					<span>If an account exists, a reset link has been sent to your email.</span>
				</div>
				<div class="mt-6">
					<a href="/signin" class="btn btn-ghost w-full">Return to Sign In</a>
				</div>
			{:else}
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
						<label class="label" for="email">
							<span class="label-text font-medium">UCF Email</span>
						</label>
						<input
							type="email"
							id="email"
							name="email"
							placeholder="jane.doe@ucf.edu"
							class="input input-bordered w-full focus:border-brand-gold focus:outline-none"
							required
							autocomplete="email"
						/>
					</div>

					<div class="mt-6">
						<button type="submit" class="btn btn-warning w-full" disabled={loading}>
							{#if loading}
								<span class="loading loading-spinner loading-sm"></span>
							{/if}
							Send Reset Link
						</button>
					</div>
				</form>

				<div class="mt-8 text-center text-sm">
					<a href="/signin" class="font-semibold text-brand-gold hover:underline">
						Back to Sign In
					</a>
				</div>
			{/if}
		</div>
	</div>
</div>
