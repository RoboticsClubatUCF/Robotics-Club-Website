<script lang="ts">
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import { motion } from 'motion-sv';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const MotionDiv = motion.div;

	const MAJORS = [
		'Computer Science',
		'Computer Engineering',
		'Electrical Engineering',
		'Mechanical Engineering',
		'Aerospace Engineering',
		'Industrial Engineering',
		'Civil Engineering',
		'Biomedical Engineering',
		'Materials Science',
		'Physics',
		'Mathematics',
		'Data Science',
		'Other'
	];

	const YEARS = ['Freshman', 'Sophomore', 'Junior', 'Senior', 'Graduate', 'Non-degree'];

	const SHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];

	const DISCOVERED_THROUGH = [
		'Discord',
		'Friend or classmate',
		'Instagram / Social media',
		'Campus tabling / flyer',
		'Orientation / Club fair',
		'Class announcement',
		'Email newsletter',
		'RCCF website',
		'Other'
	];

	const ALLERGIES = [
		'None',
		'Gluten',
		'Tree nuts',
		'Peanuts',
		'Dairy',
		'Eggs',
		'Shellfish',
		'Soy',
		'Fish',
		'Other'
	];

	// Read initial survey once — untrack signals this is intentional (form seed, not reactive binding)
	const s = untrack(() => data.survey);
	const existing = $derived(data.survey);

	let selectedMajors = $state<string[]>(s?.majors ?? []);
	let selectedDiscovered = $state<string[]>(s?.discoveredThrough ?? []);
	let selectedAllergies = $state<string[]>(s?.allergies ?? []);
	let prevMember = $state(s?.prevMember ? 'yes' : 'no');
	let loading = $state(false);

	const showOtherMajors = $derived(selectedMajors.includes('Other'));
	const showOtherAllergies = $derived(selectedAllergies.includes('Other'));
	const showSemesters = $derived(prevMember === 'yes');

	function toggle(arr: string[], value: string, checked: boolean): string[] {
		return checked ? [...arr, value] : arr.filter((v) => v !== value);
	}
</script>

<svelte:head>
	<title>Member Survey | RCCF</title>
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
		<p class="text-xs font-semibold tracking-[0.25em] text-brand-cyan uppercase">
			{existing ? 'Update' : 'Onboarding'}
		</p>
		<h1 class="mt-1 text-3xl font-black text-base-content">
			Member <span class="text-brand-gold">Survey</span>
		</h1>
		<p class="mt-2 text-sm text-base-content/50">
			{existing
				? 'Your responses are saved below. Update anything that has changed.'
				: 'Helps us tailor the experience and plan events. Takes about 2 minutes.'}
		</p>
	</MotionDiv>

	<!-- ── ERROR ───────────────────────────────────────────────────────────── -->
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

	<form
		method="POST"
		novalidate
		use:enhance={() => {
			loading = true;
			return async ({ update }) => {
				await update();
				loading = false;
			};
		}}
		class="flex flex-col gap-6"
	>
		<!-- ── SECTION 1: ABOUT YOU ────────────────────────────────────────── -->
		<MotionDiv
			initial={{ opacity: 0, y: 20 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.45, delay: 0.1 }}
		>
			<div class="card border border-base-300 bg-base-200">
				<div class="card-body gap-6">
					<h2 class="text-sm font-semibold tracking-widest text-brand-gold uppercase">About You</h2>

					<!-- Year -->
					<div class="form-control gap-2">
						<label class="label py-0" for="year">
							<span class="label-text font-medium text-base-content/80">Academic Year</span>
						</label>
						<select
							id="year"
							name="year"
							class="select-bordered select w-full focus:border-brand-gold focus:outline-none"
							required
						>
							<option value="" disabled selected={!existing?.year}>Select your year…</option>
							{#each YEARS as y}
								<option value={y} selected={existing?.year === y}>{y}</option>
							{/each}
						</select>
					</div>

					<!-- Majors -->
					<div class="form-control gap-2">
						<span class="label-text font-medium text-base-content/80">Major(s)</span>
						<div class="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
							{#each MAJORS as major}
								<label class="flex cursor-pointer items-center gap-2">
									<input
										type="checkbox"
										name="majors"
										value={major}
										class="checkbox checkbox-sm checkbox-warning"
										checked={selectedMajors.includes(major)}
										onchange={(e) => {
											selectedMajors = toggle(selectedMajors, major, e.currentTarget.checked);
										}}
									/>
									<span class="text-sm text-base-content/80">{major}</span>
								</label>
							{/each}
						</div>
					</div>

					{#if showOtherMajors}
						<MotionDiv initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
							<div class="form-control">
								<label class="label py-1" for="otherMajors">
									<span class="label-text font-medium text-base-content/80">Other major(s)</span>
								</label>
								<input
									type="text"
									id="otherMajors"
									name="otherMajors"
									placeholder="e.g. Psychology, Architecture"
									class="input-bordered input w-full focus:border-brand-gold focus:outline-none"
								/>
							</div>
						</MotionDiv>
					{/if}
				</div>
			</div>
		</MotionDiv>

		<!-- ── SECTION 2: CLUB EXPERIENCE ─────────────────────────────────── -->
		<MotionDiv
			initial={{ opacity: 0, y: 20 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.45, delay: 0.18 }}
		>
			<div class="card border border-base-300 bg-base-200">
				<div class="card-body gap-6">
					<h2 class="text-sm font-semibold tracking-widest text-brand-gold uppercase">
						Club Experience
					</h2>

					<!-- Previous member -->
					<div class="form-control gap-3">
						<span class="label-text font-medium text-base-content/80"
							>Have you been an RCCF member before?</span
						>
						<div class="flex gap-6">
							<label class="flex cursor-pointer items-center gap-2">
								<input
									type="radio"
									name="prevMember"
									value="yes"
									class="radio radio-sm radio-warning"
									checked={prevMember === 'yes'}
									onchange={() => (prevMember = 'yes')}
								/>
								<span class="text-sm text-base-content/80">Yes</span>
							</label>
							<label class="flex cursor-pointer items-center gap-2">
								<input
									type="radio"
									name="prevMember"
									value="no"
									class="radio radio-sm radio-warning"
									checked={prevMember === 'no'}
									onchange={() => (prevMember = 'no')}
								/>
								<span class="text-sm text-base-content/80">No</span>
							</label>
						</div>
					</div>

					{#if showSemesters}
						<MotionDiv initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
							<div class="form-control">
								<label class="label py-1" for="numberOfSemesters">
									<span class="label-text font-medium text-base-content/80"
										>How many semesters have you attended?</span
									>
								</label>
								<input
									type="number"
									id="numberOfSemesters"
									name="numberOfSemesters"
									min="1"
									max="30"
									placeholder="e.g. 3"
									value={existing?.numberOfSemesters || ''}
									class="input-bordered input w-40 focus:border-brand-gold focus:outline-none"
								/>
							</div>
						</MotionDiv>
					{:else}
						<input type="hidden" name="numberOfSemesters" value="0" />
					{/if}
				</div>
			</div>
		</MotionDiv>

		<!-- ── SECTION 3: LOGISTICS ────────────────────────────────────────── -->
		<MotionDiv
			initial={{ opacity: 0, y: 20 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.45, delay: 0.26 }}
		>
			<div class="card border border-base-300 bg-base-200">
				<div class="card-body gap-6">
					<h2 class="text-sm font-semibold tracking-widest text-brand-gold uppercase">Logistics</h2>

					<!-- Shirt size -->
					<div class="form-control gap-2">
						<span class="label-text font-medium text-base-content/80">Shirt Size</span>
						<div class="flex flex-wrap gap-2">
							{#each SHIRT_SIZES as size}
								<label
									class="flex cursor-pointer items-center gap-2 rounded-lg border border-base-300 px-3 py-1.5 transition-colors has-checked:border-brand-gold/60 has-checked:bg-brand-gold/10"
								>
									<input
										type="radio"
										name="shirtSize"
										value={size}
										checked={existing?.shirtSize === size}
										class="radio radio-xs radio-warning"
									/>
									<span class="text-sm font-medium text-base-content/80">{size}</span>
								</label>
							{/each}
						</div>
					</div>

					<!-- How did you hear about us -->
					<div class="form-control gap-2">
						<span class="label-text font-medium text-base-content/80"
							>How did you discover RCCF?</span
						>
						<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
							{#each DISCOVERED_THROUGH as source}
								<label class="flex cursor-pointer items-center gap-2">
									<input
										type="checkbox"
										name="discoveredThrough"
										value={source}
										class="checkbox checkbox-sm checkbox-warning"
										checked={selectedDiscovered.includes(source)}
										onchange={(e) => {
											selectedDiscovered = toggle(
												selectedDiscovered,
												source,
												e.currentTarget.checked
											);
										}}
									/>
									<span class="text-sm text-base-content/80">{source}</span>
								</label>
							{/each}
						</div>
					</div>

					<!-- Allergies -->
					<div class="form-control gap-2">
						<span class="label-text font-medium text-base-content/80"
							>Dietary restrictions / allergies</span
						>
						<div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
							{#each ALLERGIES as allergy}
								<label class="flex cursor-pointer items-center gap-2">
									<input
										type="checkbox"
										name="allergies"
										value={allergy}
										class="checkbox checkbox-sm checkbox-warning"
										checked={selectedAllergies.includes(allergy)}
										onchange={(e) => {
											selectedAllergies = toggle(
												selectedAllergies,
												allergy,
												e.currentTarget.checked
											);
										}}
									/>
									<span class="text-sm text-base-content/80">{allergy}</span>
								</label>
							{/each}
						</div>
					</div>

					{#if showOtherAllergies}
						<MotionDiv initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
							<div class="form-control">
								<label class="label py-1" for="otherAllergies">
									<span class="label-text font-medium text-base-content/80">Other allergy</span>
								</label>
								<input
									type="text"
									id="otherAllergies"
									name="otherAllergies"
									placeholder="e.g. Sesame"
									class="input-bordered input w-full focus:border-brand-gold focus:outline-none"
								/>
							</div>
						</MotionDiv>
					{/if}
				</div>
			</div>
		</MotionDiv>

		<!-- ── SECTION 4: ANYTHING ELSE ───────────────────────────────────── -->
		<MotionDiv
			initial={{ opacity: 0, y: 20 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.45, delay: 0.34 }}
		>
			<div class="card border border-base-300 bg-base-200">
				<div class="card-body gap-4">
					<h2 class="text-sm font-semibold tracking-widest text-brand-gold uppercase">
						Anything Else?
					</h2>
					<div class="form-control">
						<label class="label py-1" for="concerns">
							<span class="label-text font-medium text-base-content/80"
								>Comments or concerns <span class="text-base-content/40">(optional)</span></span
							>
						</label>
						<textarea
							id="concerns"
							name="concerns"
							rows="4"
							maxlength="2000"
							placeholder="Anything you'd like us to know…"
							class="textarea-bordered textarea w-full resize-none focus:border-brand-gold focus:outline-none"
						></textarea>
					</div>
				</div>
			</div>
		</MotionDiv>

		<!-- ── SUBMIT ──────────────────────────────────────────────────────── -->
		<MotionDiv
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			transition={{ duration: 0.4, delay: 0.4 }}
		>
			<button type="submit" class="btn w-full btn-lg btn-warning" disabled={loading}>
				{#if loading}
					<span class="loading loading-sm loading-spinner"></span>
				{/if}
				{existing ? 'Update Survey' : 'Submit Survey'}
			</button>
		</MotionDiv>
	</form>
</div>
