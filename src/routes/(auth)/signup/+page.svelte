<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let loading = $state(false);
</script>

<svelte:head>
	<title>Join Us | RCCF</title>
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
	<div class="card w-full max-w-lg border border-brand-gold/20 bg-base-100/50 shadow-xl backdrop-blur-sm">
		<div class="card-body">
			<div class="mb-6 text-center">
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

				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div class="form-control">
						<label class="label" for="firstName">
							<span class="label-text font-medium">First Name</span>
						</label>
						<input
							type="text"
							id="firstName"
							name="firstName"
							placeholder="Jane"
							class="input input-bordered w-full focus:border-brand-gold focus:outline-none"
							required
						/>
					</div>
					<div class="form-control">
						<label class="label" for="lastName">
							<span class="label-text font-medium">Last Name</span>
						</label>
						<input
							type="text"
							id="lastName"
							name="lastName"
							placeholder="Doe"
							class="input input-bordered w-full focus:border-brand-gold focus:outline-none"
						/>
					</div>
				</div>

				<div class="form-control">
					<label class="label" for="ucfEmail">
						<span class="label-text font-medium">UCF Email</span>
					</label>
					<input
						type="email"
						id="ucfEmail"
						name="ucfEmail"
						placeholder="jane.doe@ucf.edu"
						class="input input-bordered w-full focus:border-brand-gold focus:outline-none"
						required
					/>
				</div>

				<div class="form-control">
					<label class="label" for="discordUserName">
						<span class="label-text font-medium">Discord Username</span>
					</label>
					<div class="join w-full">
						<input
							type="text"
							id="discordUserName"
							name="discordUserName"
							placeholder="phibiscool"
							class="input join-item input-bordered w-full focus:border-brand-gold focus:outline-none"
							required
						/>
						<div
							class="tooltip tooltip-left join-item flex items-center bg-base-200 px-3"
							data-tip="Use your actual username, not display name"
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								fill="none"
								viewBox="0 0 24 24"
								class="h-4 w-4 stroke-current"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
								></path>
							</svg>
						</div>
					</div>
				</div>

				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div class="form-control">
						<label class="label" for="password">
							<span class="label-text font-medium">Password</span>
						</label>
						<input
							type="password"
							id="password"
							name="password"
							placeholder="••••••••"
							class="input input-bordered w-full focus:border-brand-gold focus:outline-none"
							required
							minlength="8"
						/>
					</div>
					<div class="form-control">
						<label class="label" for="confirmPassword">
							<span class="label-text font-medium">Confirm</span>
						</label>
						<input
							type="password"
							id="confirmPassword"
							name="confirmPassword"
							placeholder="••••••••"
							class="input input-bordered w-full focus:border-brand-gold focus:outline-none"
							required
						/>
					</div>
				</div>

				<div class="mt-6">
					<button type="submit" class="btn btn-warning w-full" disabled={loading}>
						{#if loading}
							<span class="loading loading-spinner loading-sm"></span>
						{/if}
						Create Account
					</button>
				</div>
			</form>

			<div class="mt-8 text-center text-sm">
				<span class="text-base-content/60">Already have an account?</span>
				<a href="/signin" class="ml-1 font-semibold text-brand-gold hover:underline">
					Sign In
				</a>
			</div>
		</div>
	</div>
</div>
