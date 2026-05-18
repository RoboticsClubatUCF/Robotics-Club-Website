<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	import { motion } from 'motion-sv';
	import DiscordUsernameGuide from '$lib/components/DiscordUsernameGuide.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let loading = $state(false);

	const MotionDiv = motion.div;
</script>

<svelte:head>
	<title>Join Us | RCCF</title>
</svelte:head>

<div class="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center px-4 py-12">
	<MotionDiv
		initial={{ opacity: 0, y: 20, scale: 0.95 }}
		animate={{ opacity: 1, y: 0, scale: 1 }}
		transition={{ duration: 0.5, ease: 'easeOut' }}
		class="card w-full max-w-lg border border-brand-gold/20 bg-base-100/50 shadow-xl backdrop-blur-sm"
	>
		<div class="card-body">
			<div class="mb-4 text-center">
				<h1 class="text-3xl font-bold tracking-tight text-brand-gold">Create Account</h1>
				<p class="mt-2 text-sm text-base-content/60">Join the Robotics Club of Central Florida</p>
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
				class="space-y-0"
				novalidate
			>
				<div class="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
					<div class="form-control">
						<label class="label py-1" for="firstName">
							<span class="label-text font-medium text-base-content/80">First Name</span>
						</label>
						<input
							type="text"
							id="firstName"
							name="firstName"
							placeholder="Jane"
							value={form?.data?.firstName ?? ''}
							class="input-bordered input w-full focus:border-brand-gold focus:outline-none"
							required
						/>
						<div class="flex h-8 items-center">
							{#if form?.field === 'firstName'}
								<MotionDiv
									initial={{ opacity: 0 }}
									animate={{ opacity: 1 }}
									class="px-1 text-[10px] leading-tight font-medium text-error"
								>
									{form.error}
								</MotionDiv>
							{/if}
						</div>
					</div>
					<div class="form-control">
						<label class="label py-1" for="lastName">
							<span class="label-text font-medium text-base-content/80">Last Name</span>
						</label>
						<input
							type="text"
							id="lastName"
							name="lastName"
							placeholder="Doe"
							value={form?.data?.lastName ?? ''}
							class="input-bordered input w-full focus:border-brand-gold focus:outline-none"
						/>
						<div class="h-8"></div>
					</div>
				</div>

				<div class="form-control">
					<label class="label py-1" for="ucfEmail">
						<span class="label-text font-medium text-base-content/80">UCF Email</span>
					</label>
					<input
						type="email"
						id="ucfEmail"
						name="ucfEmail"
						placeholder="jane.doe@ucf.edu"
						value={form?.data?.ucfEmail ?? ''}
						class="input-bordered input w-full focus:border-brand-gold focus:outline-none"
						required
					/>
					<div class="flex h-8 items-center px-1">
						{#if form?.field === 'ucfEmail'}
							<MotionDiv
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								class="text-xs leading-tight font-medium text-error"
							>
								{form.error}
							</MotionDiv>
						{/if}
					</div>
				</div>

				<div class="form-control">
					<label class="label py-1" for="discordUserName">
						<span class="label-text font-medium text-base-content/80">Discord Username</span>
					</label>
					<div class="join w-full">
						<input
							type="text"
							id="discordUserName"
							name="discordUserName"
							placeholder="phibiscool"
							value={form?.data?.discordUserName ?? ''}
							class="input-bordered input join-item w-full focus:border-brand-gold focus:outline-none"
							required
						/>
						<div
							class="join-item flex items-center border border-l-0 border-base-content/20 bg-base-200 px-3"
						>
							<DiscordUsernameGuide />
						</div>
					</div>
					<div class="flex h-8 items-center px-1">
						{#if form?.field === 'discordUserName'}
							<MotionDiv
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								class="text-xs leading-tight font-medium text-error"
							>
								{form.error}
							</MotionDiv>
						{/if}
					</div>
				</div>

				<div class="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
					<div class="form-control">
						<label class="label py-1" for="password">
							<span class="label-text font-medium text-base-content/80">Password</span>
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
						<div class="flex h-8 items-center">
							{#if form?.field === 'password'}
								<MotionDiv
									initial={{ opacity: 0 }}
									animate={{ opacity: 1 }}
									class="px-1 text-[10px] leading-tight font-medium text-error"
								>
									{form.error}
								</MotionDiv>
							{/if}
						</div>
					</div>
					<div class="form-control">
						<label class="label py-1" for="confirmPassword">
							<span class="label-text font-medium text-base-content/80">Confirm</span>
						</label>
						<input
							type="password"
							id="confirmPassword"
							name="confirmPassword"
							placeholder="••••••••"
							class="input-bordered input w-full focus:border-brand-gold focus:outline-none"
							required
						/>
						<div class="flex h-8 items-center px-1">
							{#if form?.field === 'confirmPassword'}
								<MotionDiv
									initial={{ opacity: 0 }}
									animate={{ opacity: 1 }}
									class="text-xs leading-tight font-medium text-error"
								>
									{form.error}
								</MotionDiv>
							{/if}
						</div>
					</div>
				</div>

				<div class="pt-2">
					<button type="submit" class="btn w-full btn-warning" disabled={loading}>
						{#if loading}
							<span class="loading loading-sm loading-spinner"></span>
						{/if}
						Create Account
					</button>
				</div>
			</form>

			<div class="mt-8 flex flex-col items-center gap-4 text-sm">
				<div>
					<span class="text-base-content/60">Already have an account?</span>
					<a href="/signin" class="ml-1 font-semibold text-brand-gold hover:underline"> Sign In </a>
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
