<script lang="ts">
	import { enhance } from '$app/forms';
	import { motion } from 'motion-sv';
	import DiscordUsernameGuide from '$lib/components/DiscordUsernameGuide.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const MotionDiv = motion.div;

	const user = $derived(data.user!);
	const fullName = $derived([user.firstName, user.lastName].filter(Boolean).join(' '));
	const initials = $derived(
		[user.firstName[0], user.lastName?.[0]].filter(Boolean).join('').toUpperCase()
	);
	const isActiveMember = $derived(new Date(user.membershipExpDate) > new Date());

	let updatingProfile = $state(false);
	let deletingAccount = $state(false);
	let confirmName1 = $state('');
	let confirmName2 = $state('');
	let deleteDialog: HTMLDialogElement;

	const deleteReady = $derived(confirmName1 === fullName && confirmName2 === fullName);
</script>

<svelte:head>
	<title>Profile | RCCF</title>
</svelte:head>

<div class="mx-auto max-w-2xl px-4 py-10 md:px-6">
	<!-- ── HEADER ──────────────────────────────────────────────────────────── -->
	<MotionDiv
		initial={{ opacity: 0, y: 20 }}
		animate={{ opacity: 1, y: 0 }}
		transition={{ duration: 0.5 }}
		class="mb-8"
	>
		<a
			href="/dashboard"
			class="mb-4 inline-flex items-center gap-1.5 text-sm text-base-content/50 hover:text-brand-gold"
		>
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
			Dashboard
		</a>

		<div class="flex items-center gap-4">
			<!-- Avatar -->
			<div class="placeholder avatar">
				<div
					class="h-16 w-16 rounded-full border-2 border-brand-gold/30 bg-base-300 text-base-content"
				>
					{#if user.profileImage}
						<img src={user.profileImage.url} alt={user.profileImage.alt ?? fullName} />
					{:else}
						<span class="text-xl font-bold">{initials}</span>
					{/if}
				</div>
			</div>
			<div>
				<p class="text-xs font-semibold tracking-[0.25em] text-brand-cyan uppercase">Profile</p>
				<h1 class="text-2xl font-black text-base-content">{fullName}</h1>
				<p class="mt-0.5 text-sm text-base-content/50">@{user.discordUserName}</p>
			</div>
		</div>
	</MotionDiv>

	<!-- ── SUCCESS / ERROR ALERTS ──────────────────────────────────────────── -->
	{#if form?.success}
		<MotionDiv initial={{ opacity: 0 }} animate={{ opacity: 1 }} class="mb-6">
			<div role="alert" class="alert alert-success">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-5 w-5 shrink-0"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M5 13l4 4L19 7"
					/>
				</svg>
				<div>
					<p class="font-semibold">Profile updated</p>
					{#if !form.discordSynced}
						<p class="text-sm">
							Discord role sync failed — ask an officer if your role isn't updated.
						</p>
					{/if}
				</div>
			</div>
		</MotionDiv>
	{/if}

	{#if form?.error}
		<MotionDiv initial={{ opacity: 0 }} animate={{ opacity: 1 }} class="mb-6">
			<div role="alert" class="alert alert-error">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-5 w-5 shrink-0"
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
				<span>{form.error}</span>
			</div>
		</MotionDiv>
	{/if}

	<div class="flex flex-col gap-6">
		<!-- ── EDIT PROFILE ────────────────────────────────────────────────── -->
		<MotionDiv
			initial={{ opacity: 0, y: 20 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.45, delay: 0.1 }}
		>
			<div class="card border border-base-300 bg-base-200">
				<div class="card-body gap-5">
					<h2 class="text-sm font-semibold tracking-widest text-brand-gold uppercase">
						Edit Profile
					</h2>

					<form
						method="POST"
						action="?/updateProfile"
						novalidate
						use:enhance={() => {
							updatingProfile = true;
							return async ({ update }) => {
								await update();
								updatingProfile = false;
							};
						}}
						class="flex flex-col gap-4"
					>
						<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
							<div class="form-control">
								<label class="label py-1" for="firstName">
									<span class="label-text font-medium text-base-content/80">First Name</span>
								</label>
								<input
									type="text"
									id="firstName"
									name="firstName"
									value={user.firstName}
									class="input-bordered input w-full focus:border-brand-gold focus:outline-none"
									required
								/>
							</div>
							<div class="form-control">
								<label class="label py-1" for="lastName">
									<span class="label-text font-medium text-base-content/80">
										Last Name <span class="text-base-content/40">(optional)</span>
									</span>
								</label>
								<input
									type="text"
									id="lastName"
									name="lastName"
									value={user.lastName ?? ''}
									class="input-bordered input w-full focus:border-brand-gold focus:outline-none"
								/>
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
								value={user.ucfEmail}
								class="input-bordered input w-full focus:border-brand-gold focus:outline-none"
								required
							/>
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
									value={user.discordUserName}
									class="input-bordered input join-item w-full focus:border-brand-gold focus:outline-none"
									required
								/>
								<div
									class="join-item flex items-center border border-l-0 border-base-content/20 bg-base-300 px-3"
								>
									<DiscordUsernameGuide />
								</div>
							</div>
							<p class="mt-1.5 px-1 text-xs text-base-content/40">
								Changing this re-syncs your Discord role.
							</p>
						</div>

						<div class="pt-1">
							<button type="submit" class="btn btn-warning" disabled={updatingProfile}>
								{#if updatingProfile}
									<span class="loading loading-sm loading-spinner"></span>
								{/if}
								Save Changes
							</button>
						</div>
					</form>
				</div>
			</div>
		</MotionDiv>

		<!-- ── ACCOUNT DETAILS ────────────────────────────────────────────── -->
		<MotionDiv
			initial={{ opacity: 0, y: 20 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.45, delay: 0.18 }}
		>
			<div class="card border border-base-300 bg-base-200">
				<div class="card-body gap-4">
					<h2 class="text-sm font-semibold tracking-widest text-brand-gold uppercase">
						Account Details
					</h2>
					<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
						<div class="rounded-lg bg-base-300 px-4 py-3">
							<p class="text-xs text-base-content/40 uppercase">Role</p>
							<p class="mt-0.5 font-semibold text-base-content capitalize">{user.role.name}</p>
						</div>
						<div class="rounded-lg bg-base-300 px-4 py-3">
							<p class="text-xs text-base-content/40 uppercase">Membership</p>
							<div class="mt-0.5 flex items-center gap-2">
								<span class="font-semibold text-base-content">
									{#if isActiveMember}
										Active until {new Date(user.membershipExpDate).toLocaleDateString()}
									{:else}
										Expired
									{/if}
								</span>
								<span class="badge badge-xs {isActiveMember ? 'badge-success' : 'badge-error'}"
								></span>
							</div>
						</div>
					</div>
				</div>
			</div>
		</MotionDiv>

		<!-- ── DANGER ZONE ────────────────────────────────────────────────── -->
		<MotionDiv
			initial={{ opacity: 0, y: 20 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.45, delay: 0.26 }}
		>
			<div class="card border border-error/20 bg-base-200">
				<div class="card-body gap-3">
					<h2 class="text-sm font-semibold tracking-widest text-error uppercase">Danger Zone</h2>
					<div class="flex items-center justify-between gap-4">
						<div>
							<p class="font-medium text-base-content">Delete account</p>
							<p class="text-sm text-base-content/50">
								Permanently removes your account and all associated data. This cannot be undone.
							</p>
						</div>
						<button
							type="button"
							class="btn shrink-0 btn-outline btn-sm btn-error"
							onclick={() => deleteDialog.showModal()}
						>
							Delete
						</button>
					</div>
				</div>
			</div>
		</MotionDiv>
	</div>
</div>

<!-- ── DELETE MODAL ────────────────────────────────────────────────────────── -->
<dialog bind:this={deleteDialog} class="modal">
	<div class="modal-box border border-error/30 bg-base-200">
		<h3 class="text-lg font-bold text-error">Delete Account</h3>
		<p class="mt-2 text-sm text-base-content/60">
			This will permanently delete your account, survey, and all project memberships. There is no
			recovery.
		</p>

		{#if form?.deleteError}
			<div role="alert" class="mt-4 alert py-2 text-sm alert-error">
				<span>{form.deleteError}</span>
			</div>
		{/if}

		<form
			method="POST"
			action="?/deleteAccount"
			class="mt-5 flex flex-col gap-3"
			use:enhance={() => {
				deletingAccount = true;
				return async ({ update }) => {
					await update();
					deletingAccount = false;
				};
			}}
		>
			<p class="text-sm font-medium text-base-content/80">
				Type your full name <span class="font-mono font-bold text-base-content">{fullName}</span> twice
				to confirm.
			</p>
			<input
				type="text"
				name="confirmName1"
				placeholder={fullName}
				autocomplete="off"
				class="input-bordered input w-full input-error focus:outline-none"
				bind:value={confirmName1}
			/>
			<input
				type="text"
				name="confirmName2"
				placeholder={fullName}
				autocomplete="off"
				class="input-bordered input w-full input-error focus:outline-none"
				bind:value={confirmName2}
			/>
			<div class="modal-action mt-2">
				<button
					type="button"
					class="btn btn-ghost"
					onclick={() => {
						deleteDialog.close();
						confirmName1 = '';
						confirmName2 = '';
					}}
				>
					Cancel
				</button>
				<button type="submit" class="btn btn-error" disabled={!deleteReady || deletingAccount}>
					{#if deletingAccount}
						<span class="loading loading-sm loading-spinner"></span>
					{/if}
					Delete My Account
				</button>
			</div>
		</form>
	</div>
	<form method="dialog" class="modal-backdrop">
		<button
			onclick={() => {
				confirmName1 = '';
				confirmName2 = '';
			}}>close</button
		>
	</form>
</dialog>
