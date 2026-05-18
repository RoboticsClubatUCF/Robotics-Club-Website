<script lang="ts">
	import { enhance } from '$app/forms';
	import { motion } from 'motion-sv';
	import { ROLES } from '$lib/constants';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const MotionDiv = motion.div;

	const user = $derived(data.user!);
	const isActiveMember = $derived(new Date(user.membershipExpDate) > new Date());
	const hasSurvey = $derived(!!user.survey);
	const isOfficerPlus = $derived(user.role.permissionLevel >= ROLES.officer.level);
	const isProjectLeadPlus = $derived(user.role.permissionLevel >= ROLES.projectLead.level);
	const isAdmin = $derived(user.role.permissionLevel >= ROLES.admin.level);
	const myProjects = $derived(user.projectUsers);
	const canJoin = $derived(hasSurvey && (data.currentSemester === 'summer' || isActiveMember));

	let joiningId = $state<number | null>(null);
	let claimingGrace = $state(false);
	let claimingSummer = $state(false);

	const semesterLabels: Record<string, string> = {
		spring: 'Spring',
		summer: 'Summer',
		fall: 'Fall'
	};
</script>

<svelte:head>
	<title>Dashboard | RCCF</title>
</svelte:head>

<div class="mx-auto max-w-5xl px-4 py-10 md:px-6">
	<!-- ── HEADER ──────────────────────────────────────────────────────────── -->
	<MotionDiv
		initial={{ opacity: 0, y: 20 }}
		animate={{ opacity: 1, y: 0 }}
		transition={{ duration: 0.5, ease: 'easeOut' }}
		class="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
	>
		<div>
			<a
				href="/"
				class="group mb-2 flex items-center gap-1.5 text-xs font-medium text-base-content/40 transition-colors hover:text-brand-gold"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5"
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
				Back to Site
			</a>
			<p class="text-xs font-semibold tracking-[0.25em] text-brand-cyan uppercase">Dashboard</p>
			<h1 class="mt-1 text-3xl font-black text-base-content md:text-4xl">
				Hello, <span class="text-brand-gold">{user.firstName}</span>
			</h1>
			<p class="mt-1.5 text-sm text-base-content/50">
				@{user.discordUserName} · {user.ucfEmail}
			</p>
		</div>
		<div class="flex flex-wrap items-center gap-2 sm:mt-2">
			<div class="badge gap-1.5 badge-lg {isActiveMember ? 'badge-success' : 'badge-error'}">
				{#if isActiveMember}
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-3.5 w-3.5"
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
					Active Member
				{:else}
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-3.5 w-3.5"
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
					Membership Expired
				{/if}
			</div>
			<div class="badge badge-outline badge-lg capitalize">{user.role.name}</div>
		</div>
	</MotionDiv>

	<!-- ── ALERTS ──────────────────────────────────────────────────────────── -->
	<div class="mb-8 flex flex-col gap-3">
		{#if form?.error}
			<MotionDiv initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
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

		{#if form?.success}
			<MotionDiv initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
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
					<span>You've joined the project!</span>
				</div>
			</MotionDiv>
		{/if}

		{#if !hasSurvey}
			<MotionDiv
				initial={{ opacity: 0, x: -16 }}
				animate={{ opacity: 1, x: 0 }}
				transition={{ duration: 0.4 }}
			>
				<div role="alert" class="alert alert-warning">
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
							d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
						/>
					</svg>
					<div>
						<p class="font-semibold">Member survey incomplete</p>
						<p class="text-sm">Complete your survey to unlock project registration.</p>
					</div>
					<a href="/dashboard/survey" class="btn btn-sm btn-warning">Complete Survey</a>
				</div>
			</MotionDiv>
		{/if}

		{#if data.isGracePeriod && !isActiveMember}
			<MotionDiv
				initial={{ opacity: 0, x: -16 }}
				animate={{ opacity: 1, x: 0 }}
				transition={{ duration: 0.4, delay: 0.05 }}
			>
				<div role="alert" class="alert alert-info">
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
							d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
						/>
					</svg>
					<div>
						<p class="font-semibold">Grace period active</p>
						<p class="text-sm">
							Claim a free temporary membership valid until
							{new Date(data.gracePeriodExpiry!).toLocaleDateString()}.
						</p>
					</div>
					<form
						method="POST"
						action="?/graceRole"
						use:enhance={() => {
							claimingGrace = true;
							return async ({ update }) => {
								await update();
								claimingGrace = false;
							};
						}}
					>
						<input type="hidden" name="id" value={user.id} />
						<button type="submit" class="btn btn-sm btn-info" disabled={claimingGrace}>
							{#if claimingGrace}<span class="loading loading-xs loading-spinner"></span>{/if}
							Claim
						</button>
					</form>
				</div>
			</MotionDiv>
		{/if}

		{#if data.isSummerPeriod && !isActiveMember}
			<MotionDiv
				initial={{ opacity: 0, x: -16 }}
				animate={{ opacity: 1, x: 0 }}
				transition={{ duration: 0.4, delay: 0.1 }}
			>
				<div role="alert" class="alert alert-info">
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
							d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364-.707-.707M6.343 6.343l-.707-.707m12.728 0-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
						/>
					</svg>
					<div>
						<p class="font-semibold">Summer membership available</p>
						<p class="text-sm">Enroll for free through the end of the summer term.</p>
					</div>
					<form
						method="POST"
						action="?/summerRole"
						use:enhance={() => {
							claimingSummer = true;
							return async ({ update }) => {
								await update();
								claimingSummer = false;
							};
						}}
					>
						<input type="hidden" name="id" value={user.id} />
						<button type="submit" class="btn btn-sm btn-info" disabled={claimingSummer}>
							{#if claimingSummer}<span class="loading loading-xs loading-spinner"></span>{/if}
							Enroll
						</button>
					</form>
				</div>
			</MotionDiv>
		{/if}
	</div>

	<!-- ── QUICK ACCESS ────────────────────────────────────────────────────── -->
	<MotionDiv
		initial={{ opacity: 0, y: 20 }}
		animate={{ opacity: 1, y: 0 }}
		transition={{ duration: 0.5, delay: 0.15 }}
		class="mb-10"
	>
		<p class="mb-4 text-xs font-semibold tracking-[0.25em] text-base-content/40 uppercase">
			Quick Access
		</p>
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
			<a
				href="/dashboard/profile"
				class="card border border-base-300 bg-base-200 transition-colors hover:border-brand-gold/30 hover:bg-base-300"
			>
				<div class="card-body gap-2 p-5">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-6 w-6 text-brand-gold"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.5"
							d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
						/>
					</svg>
					<p class="font-semibold text-base-content">Profile</p>
					<p class="text-xs text-base-content/50">Edit your account</p>
				</div>
			</a>

			<a
				href="/dashboard/survey"
				class="card border bg-base-200 transition-colors hover:bg-base-300 {hasSurvey
					? 'border-base-300 hover:border-brand-gold/30'
					: 'border-warning/40 hover:border-warning/60'}"
			>
				<div class="card-body gap-2 p-5">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-6 w-6 {hasSurvey ? 'text-success' : 'text-warning'}"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.5"
							d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
						/>
					</svg>
					<p class="font-semibold text-base-content">Survey</p>
					<p class="text-xs text-base-content/50">{hasSurvey ? 'Completed' : 'Action needed'}</p>
				</div>
			</a>

			{#if isProjectLeadPlus}
				<a
					href="/dashboard/manage-project"
					class="card border border-base-300 bg-base-200 transition-colors hover:border-brand-cyan/30 hover:bg-base-300"
				>
					<div class="card-body gap-2 p-5">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-6 w-6 text-brand-cyan"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.5"
								d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
							/><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.5"
								d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
							/>
						</svg>
						<p class="font-semibold text-base-content">Manage Projects</p>
						<p class="text-xs text-base-content/50">Edit your team</p>
					</div>
				</a>
			{/if}

			{#if isOfficerPlus}
				<a
					href="/dashboard/manage-sponsors"
					class="card border border-base-300 bg-base-200 transition-colors hover:border-brand-gold/30 hover:bg-base-300"
				>
					<div class="card-body gap-2 p-5">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-6 w-6 text-brand-gold"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.5"
								d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
						<p class="font-semibold text-base-content">Sponsors</p>
						<p class="text-xs text-base-content/50">Manage sponsorships</p>
					</div>
				</a>
			{/if}

			{#if isAdmin}
				<a
					href="/dashboard/admin"
					class="card border border-base-300 bg-base-200 transition-colors hover:border-error/30 hover:bg-base-300"
				>
					<div class="card-body gap-2 p-5">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-6 w-6 text-error"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.5"
								d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
							/>
						</svg>
						<p class="font-semibold text-base-content">Admin Panel</p>
						<p class="text-xs text-base-content/50">Manage members</p>
					</div>
				</a>
			{/if}
		</div>
	</MotionDiv>

	<!-- ── MY PROJECTS ─────────────────────────────────────────────────────── -->
	<MotionDiv
		initial={{ opacity: 0, y: 20 }}
		whileInView={{ opacity: 1, y: 0 }}
		inViewOptions={{ once: true }}
		transition={{ duration: 0.5 }}
		class="mb-10"
	>
		<p class="mb-4 text-xs font-semibold tracking-[0.25em] text-base-content/40 uppercase">
			My Projects — {semesterLabels[data.currentSemester] ?? data.currentSemester}
			{data.currentYear}
		</p>

		{#if myProjects.length === 0}
			<div
				class="rounded-box border border-dashed border-base-300 bg-base-200 px-6 py-10 text-center"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="mx-auto mb-3 h-8 w-8 text-base-content/20"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="1.5"
						d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
					/>
				</svg>
				<p class="text-sm text-base-content/40">You haven't joined any projects this semester.</p>
			</div>
		{:else}
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each myProjects as pu, i}
					<MotionDiv
						initial={{ opacity: 0, y: 20 }}
						whileInView={{ opacity: 1, y: 0 }}
						inViewOptions={{ once: true }}
						transition={{ duration: 0.4, delay: i * 0.07 }}
						whileHover={{ y: -4 }}
					>
						<div
							class="card h-full border border-base-300 bg-base-200 transition-colors hover:border-brand-gold/20"
						>
							{#if pu.project.logo}
								<figure class="px-4 pt-4">
									<img
										src={pu.project.logo.url}
										alt={pu.project.logo.alt ?? pu.project.title}
										class="h-14 w-full rounded-lg object-contain"
									/>
								</figure>
							{/if}
							<div class="card-body gap-2 p-5">
								<h3 class="card-title text-sm text-base-content">{pu.project.title}</h3>
								{#if pu.roleName}
									<span class="badge badge-outline badge-sm capitalize">{pu.roleName}</span>
								{/if}
								{#if pu.project.skills.length > 0}
									<div class="mt-1 flex flex-wrap gap-1">
										{#each pu.project.skills.slice(0, 3) as skill}
											<span class="badge badge-ghost badge-xs">{skill}</span>
										{/each}
										{#if pu.project.skills.length > 3}
											<span class="badge badge-ghost badge-xs">+{pu.project.skills.length - 3}</span
											>
										{/if}
									</div>
								{/if}
								{#if pu.project.docsLink}
									<div class="mt-1 card-actions">
										<a
											href={pu.project.docsLink}
											target="_blank"
											rel="noopener noreferrer"
											class="btn gap-1.5 text-brand-cyan btn-ghost btn-xs"
										>
											<svg
												xmlns="http://www.w3.org/2000/svg"
												class="h-3.5 w-3.5"
												fill="none"
												viewBox="0 0 24 24"
												stroke="currentColor"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
												/>
											</svg>
											Docs
										</a>
									</div>
								{/if}
							</div>
						</div>
					</MotionDiv>
				{/each}
			</div>
		{/if}
	</MotionDiv>

	<!-- ── JOIN A PROJECT ──────────────────────────────────────────────────── -->
	{#if data.joinableProjects.length > 0}
		<MotionDiv
			initial={{ opacity: 0, y: 20 }}
			whileInView={{ opacity: 1, y: 0 }}
			inViewOptions={{ once: true }}
			transition={{ duration: 0.5 }}
		>
			<p class="mb-4 text-xs font-semibold tracking-[0.25em] text-base-content/40 uppercase">
				Join a Project
			</p>

			{#if !canJoin}
				<div role="alert" class="mb-4 alert">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-5 w-5 shrink-0 text-base-content/40"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
						/>
					</svg>
					<span class="text-sm text-base-content/60">
						{#if !hasSurvey}
							Complete your member survey before joining a project.
						{:else}
							An active membership is required to join a project this semester.
						{/if}
					</span>
				</div>
			{/if}

			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each data.joinableProjects as project, i}
					<MotionDiv
						initial={{ opacity: 0, y: 24 }}
						whileInView={{ opacity: 1, y: 0 }}
						inViewOptions={{ once: true }}
						transition={{ duration: 0.4, delay: i * 0.07 }}
						whileHover={{ y: -4 }}
					>
						<div
							class="card h-full border border-base-300 bg-base-200 transition-colors hover:border-brand-gold/20"
						>
							{#if project.logo}
								<figure class="px-4 pt-4">
									<img
										src={project.logo.url}
										alt={project.logo.alt ?? project.title}
										class="h-14 w-full rounded-lg object-contain"
									/>
								</figure>
							{/if}
							<div class="card-body gap-2 p-5">
								<h3 class="card-title text-sm text-base-content">{project.title}</h3>
								<p class="line-clamp-2 text-xs leading-relaxed text-base-content/50">
									{project.description}
								</p>
								{#if project.skills.length > 0}
									<div class="flex flex-wrap gap-1">
										{#each project.skills.slice(0, 3) as skill}
											<span class="badge badge-ghost badge-xs">{skill}</span>
										{/each}
										{#if project.skills.length > 3}
											<span class="badge badge-ghost badge-xs">+{project.skills.length - 3}</span>
										{/if}
									</div>
								{/if}
								<div class="mt-2 card-actions">
									<form
										method="POST"
										action="?/joinProject"
										use:enhance={() => {
											joiningId = project.id;
											return async ({ update }) => {
												await update();
												joiningId = null;
											};
										}}
									>
										<input type="hidden" name="projectId" value={project.id} />
										<button
											type="submit"
											class="btn btn-sm btn-warning"
											disabled={!canJoin || joiningId !== null}
										>
											{#if joiningId === project.id}
												<span class="loading loading-xs loading-spinner"></span>
											{/if}
											Join
										</button>
									</form>
								</div>
							</div>
						</div>
					</MotionDiv>
				{/each}
			</div>
		</MotionDiv>
	{/if}
</div>
