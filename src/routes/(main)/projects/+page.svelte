<script lang="ts">
	import { motion } from 'motion-sv';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const MotionDiv = motion.div;
	const MotionSection = motion.section;

	const seasonOrder: Record<string, number> = { fall: 0, spring: 1, summer: 2 };
	const seasonLabel: Record<string, string> = {
		fall: 'Fall',
		spring: 'Spring',
		summer: 'Summer'
	};

	// All unique years, descending
	const years = $derived([...new Set(data.projects.map((p) => p.year))].sort((a, b) => b - a));

	let selectedYear = $state<number | null>(null);
	const activeYear = $derived(selectedYear ?? years[0] ?? null);

	const visibleProjects = $derived(
		data.projects
			.filter((p) => activeYear === null || p.year === activeYear)
			.sort((a, b) => seasonOrder[a.season] - seasonOrder[b.season])
	);
</script>

<!-- ─── HERO ─────────────────────────────────────────────────────────────── -->
<section class="relative overflow-hidden bg-base-100 px-4 py-24 text-center">
	<div class="pointer-events-none absolute inset-0">
		<div class="absolute top-0 right-0 left-0 h-px bg-brand-gold/15"></div>
		<div class="absolute right-0 bottom-0 left-0 h-px bg-brand-gold/15"></div>
	</div>

	<MotionDiv
		initial={{ opacity: 0, y: 20 }}
		animate={{ opacity: 1, y: 0 }}
		transition={{ duration: 0.6 }}
	>
		<p class="mb-3 text-xs font-semibold tracking-[0.3em] text-brand-cyan uppercase">
			Engineering Excellence
		</p>
		<h1 class="text-4xl font-black text-base-content md:text-6xl">
			Our <span class="text-brand-gold">Projects</span>
		</h1>
		<p class="mx-auto mt-5 max-w-xl text-base leading-relaxed text-base-content/60">
			Every semester, teams tackle ambitious robotics challenges — from autonomous navigation to
			competition hardware. Here's what we've built.
		</p>
	</MotionDiv>
</section>

<!-- ─── YEAR FILTER ───────────────────────────────────────────────────────── -->
{#if years.length > 0}
	<div class="sticky top-16 z-40 border-b border-base-300 bg-base-100/90 backdrop-blur-sm">
		<div class="mx-auto max-w-7xl overflow-x-auto px-4 md:px-6">
			<div class="flex gap-1 py-3">
				{#each years as year}
					<button
						class="btn shrink-0 btn-sm {activeYear === year
							? 'btn-warning'
							: 'text-base-content/60 btn-ghost hover:text-base-content'}"
						onclick={() => (selectedYear = year)}
					>
						{year}
					</button>
				{/each}
			</div>
		</div>
	</div>
{/if}

<!-- ─── PROJECTS GRID ─────────────────────────────────────────────────────── -->
<MotionSection
	initial={{ opacity: 0 }}
	animate={{ opacity: 1 }}
	transition={{ duration: 0.4 }}
	class="mx-auto max-w-7xl px-4 py-16 md:px-6"
>
	{#if visibleProjects.length === 0}
		<div class="flex flex-col items-center justify-center gap-4 py-24 text-center">
			<div class="text-5xl opacity-20">⚙️</div>
			<h3 class="text-xl font-bold text-base-content/40">No projects yet</h3>
			<p class="text-sm text-base-content/30">
				Projects will appear here once they're added by club leadership.
			</p>
		</div>
	{:else}
		<!-- Group by season -->
		{#each [...new Set(visibleProjects.map((p) => p.season))] as season}
			{@const group = visibleProjects.filter((p) => p.season === season)}
			<div class="mb-12">
				<MotionDiv
					initial={{ opacity: 0, x: -16 }}
					whileInView={{ opacity: 1, x: 0 }}
					inViewOptions={{ once: true }}
					transition={{ duration: 0.4 }}
					class="mb-6 flex items-center gap-3"
				>
					<div class="h-px flex-1 bg-base-300"></div>
					<span class="text-xs font-semibold tracking-[0.25em] text-brand-cyan uppercase">
						{seasonLabel[season]}
						{activeYear}
					</span>
					<div class="h-px flex-1 bg-base-300"></div>
				</MotionDiv>

				<div class="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
					{#each group as project, i}
						<MotionDiv
							initial={{ opacity: 0, y: 28 }}
							whileInView={{ opacity: 1, y: 0 }}
							inViewOptions={{ once: true }}
							transition={{ duration: 0.45, delay: i * 0.07 }}
							whileHover={{ y: -6, scale: 1.02 }}
							class="card h-full border border-base-300 bg-base-200 transition-colors hover:border-brand-gold/30"
						>
							<!-- Logo or placeholder -->
							<figure class="flex h-40 items-center justify-center overflow-hidden bg-base-300">
								{#if project.logo}
									<img
										src={project.logo.url}
										alt={project.logo.alt ?? project.title}
										class="h-full w-full object-contain p-6"
									/>
								{:else}
									<svg
										xmlns="http://www.w3.org/2000/svg"
										class="h-16 w-16 text-base-content/10"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="1"
											d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
										/>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="1"
											d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
										/>
									</svg>
								{/if}
							</figure>

							<div class="card-body gap-3 p-5">
								<h3 class="card-title text-sm leading-snug font-bold text-base-content">
									{project.title}
								</h3>
								<p class="line-clamp-3 text-xs leading-relaxed text-base-content/55">
									{project.description}
								</p>

								{#if project.skills && project.skills.length > 0}
									<div class="flex flex-wrap gap-1.5 pt-1">
										{#each project.skills.slice(0, 5) as skill}
											<span
												class="badge border-brand-cyan/30 bg-brand-cyan/5 badge-sm text-brand-cyan"
												>{skill}</span
											>
										{/each}
										{#if project.skills.length > 5}
											<span class="badge badge-ghost badge-sm text-base-content/40"
												>+{project.skills.length - 5}</span
											>
										{/if}
									</div>
								{/if}

								{#if project.docsLink}
									<div class="card-actions pt-2">
										<a
											href={project.docsLink}
											target="_blank"
											rel="noopener noreferrer"
											class="btn border-brand-gold/40 text-brand-gold btn-outline btn-xs hover:bg-brand-gold hover:text-base-100"
										>
											View Docs ↗
										</a>
									</div>
								{/if}
							</div>
						</MotionDiv>
					{/each}
				</div>
			</div>
		{/each}
	{/if}
</MotionSection>

<!-- ─── CTA ───────────────────────────────────────────────────────────────── -->
<MotionDiv
	initial={{ opacity: 0, y: 20 }}
	whileInView={{ opacity: 1, y: 0 }}
	inViewOptions={{ once: true }}
	transition={{ duration: 0.6 }}
	class="border-t border-base-300 bg-base-200 px-4 py-16 text-center"
>
	<h3 class="text-2xl font-bold text-base-content">Want to start a project?</h3>
	<p class="mx-auto mt-3 max-w-sm text-sm text-base-content/60">
		Join RCCF and pitch your idea. If it's ambitious, we'll help you build it.
	</p>
	<a href="/signup" class="btn mt-8 btn-warning">Join & Propose a Project</a>
</MotionDiv>
