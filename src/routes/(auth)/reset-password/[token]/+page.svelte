<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	import { motion } from 'motion-sv';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let loading = $state(false);

	const MotionDiv = motion.div;
</script>

<svelte:head>
	<title>Reset Password | RCCF</title>
</svelte:head>

<div class="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center px-4 py-12">
	<MotionDiv
		initial={{ opacity: 0, y: 20, scale: 0.95 }}
		animate={{ opacity: 1, y: 0, scale: 1 }}
		transition={{ duration: 0.5, ease: 'easeOut' }}
		class="card w-full max-w-md border border-brand-gold/20 bg-base-100/50 shadow-xl backdrop-blur-sm"
	>
		<div class="card-body">
			<div class="mb-6 text-center">
				<h1 class="text-3xl font-bold tracking-tight text-brand-gold">New Password</h1>
				<p class="mt-2 text-sm text-base-content/60">Choose a strong password for your account</p>
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
					<div class="alert text-sm alert-error">
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
					<label class="label" for="password">
						<span class="label-text font-medium">New Password</span>
					</label>
					<input
						type="password"
						id="password"
						name="password"
						placeholder="••••••••"
						class="input-bordered input w-full focus:border-brand-gold focus:outline-none"
						required
						minlength="8"
					/>
				</div>

				<div class="form-control">
					<label class="label" for="confirmPassword">
						<span class="label-text font-medium">Confirm New Password</span>
					</label>
					<input
						type="password"
						id="confirmPassword"
						name="confirmPassword"
						placeholder="••••••••"
						class="input-bordered input w-full focus:border-brand-gold focus:outline-none"
						required
					/>
				</div>

				<div class="mt-6">
					<button type="submit" class="btn w-full btn-warning" disabled={loading}>
						{#if loading}
							<span class="loading loading-sm loading-spinner"></span>
						{/if}
						Update Password
					</button>
				</div>
			</form>

			<div class="mt-8 flex flex-col items-center gap-4 text-sm">
				<div>
					<a href="/signin" class="font-semibold text-brand-gold hover:underline">
						Cancel and return to Sign In
					</a>
				</div>
				<a href="/" class="btn gap-2 text-base-content/60 btn-ghost btn-sm hover:text-brand-gold">
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
		</div>
	</MotionDiv>
</div>
