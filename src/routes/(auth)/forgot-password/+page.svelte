<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	import { motion } from 'motion-sv';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let loading = $state(false);

	const MotionDiv = motion.div;
</script>

<svelte:head>
	<title>Forgot Password | RCCF</title>
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
				<h1 class="text-3xl font-bold tracking-tight text-brand-gold">Reset Password</h1>
				<p class="mt-2 text-sm text-base-content/60">Enter your email to receive a reset link</p>
			</div>

			{#if form?.success}
				<div class="alert py-3 text-sm alert-success shadow-md" role="alert">
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
				<div class="mt-8 flex flex-col items-center gap-4">
					<a href="/signin" class="btn w-full btn-ghost">Return to Sign In</a>
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
					class="space-y-0"
					novalidate
				>
					<div class="form-control">
						<label class="label py-1" for="email">
							<span class="label-text font-medium text-base-content/80">UCF Email</span>
						</label>
						<input
							type="email"
							id="email"
							name="ucfEmail"
							placeholder="jane.doe@ucf.edu"
							value={form?.data?.ucfEmail ?? ''}
							class="input-bordered input w-full focus:border-brand-gold focus:outline-none"
							required
							autocomplete="email"
						/>
						<div class="flex h-8 items-center px-1">
							{#if form?.field === 'ucfEmail'}
								<MotionDiv
									initial={{ opacity: 0 }}
									animate={{ opacity: 1 }}
									class="flex items-center gap-2 text-xs leading-tight font-medium text-error"
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										class="h-3.5 w-3.5 shrink-0"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 14c-.77 1.333.192 3 1.732 3z"
										/>
									</svg>
									{form.error}
								</MotionDiv>
							{/if}
						</div>
					</div>

					<div class="pt-2">
						<button type="submit" class="btn w-full btn-warning" disabled={loading}>
							{#if loading}
								<span class="loading loading-sm loading-spinner"></span>
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

			<div class="mt-6 flex justify-center">
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
