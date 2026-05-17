<script lang="ts">
	import { motion } from 'motion-sv';

	const MotionDiv = motion.div;
	const MotionSection = motion.section;

	const sections = [
		{
			label: 'Who We Reach',
			heading: 'Robotics for Everyone',
			body: "We believe engineering shouldn't be locked behind a university gate. RCCF volunteers teach robotics concepts to K-12 students across Central Florida — from basic circuitry to programming autonomous systems — planting the seeds for the next generation of builders.",
			image: '/photos/outreach1.jpg',
			imageAlt: 'RCCF members teaching students',
			imageRight: false
		},
		{
			label: 'Our Programs',
			heading: 'Hands-On Workshops',
			body: 'Our outreach programs are built around doing, not listening. Students get to wire circuits, write code, and drive robots they built themselves. We partner with local schools, libraries, and community centers to bring these experiences to as many students as possible.',
			image: '/photos/outreach2.jpg',
			imageAlt: 'Workshop in progress',
			imageRight: true
		},
		{
			label: 'Research & Academia',
			heading: 'Bridging Campus & Community',
			body: "RCCF also connects with UCF's research community — students collaborate on real academic projects and apply classroom knowledge to problems that matter. Our members present at conferences, author papers, and work alongside faculty on robotics and AI research.",
			image: '/photos/outreach3.png',
			imageAlt: 'Academic research outreach',
			imageRight: false
		}
	];
</script>

<!-- ─── HERO ─────────────────────────────────────────────────────────────── -->
<section class="relative overflow-hidden bg-base-100 px-4 py-24 text-center">
	<div class="pointer-events-none absolute inset-0">
		<div
			class="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_0%,rgba(67,197,215,0.04),transparent)]"
		></div>
		<div class="absolute top-0 right-0 left-0 h-px bg-brand-cyan/20"></div>
	</div>

	<MotionDiv
		initial={{ opacity: 0, y: 20 }}
		animate={{ opacity: 1, y: 0 }}
		transition={{ duration: 0.6 }}
	>
		<p class="mb-3 text-xs font-semibold tracking-[0.3em] text-brand-cyan uppercase">
			Community Impact
		</p>
		<h1 class="text-4xl font-black text-base-content md:text-6xl">
			Community <span class="text-brand-gold">Outreach</span>
		</h1>
		<p class="mx-auto mt-5 max-w-xl text-base leading-relaxed text-base-content/60">
			Engineering is a tool for change. We take it out of the lab and into communities — teaching,
			inspiring, and building alongside the next generation.
		</p>
	</MotionDiv>
</section>

<!-- ─── ALTERNATING SECTIONS ─────────────────────────────────────────────── -->
<div class="mx-auto max-w-7xl px-4 py-16 md:px-6">
	{#each sections as section, i}
		<MotionSection
			initial={{ opacity: 0, y: 40 }}
			whileInView={{ opacity: 1, y: 0 }}
			inViewOptions={{ once: true }}
			transition={{ duration: 0.65 }}
			class="mb-20 last:mb-8"
		>
			<div
				class="flex flex-col gap-8 {section.imageRight
					? 'lg:flex-row-reverse'
					: 'lg:flex-row'} items-center"
			>
				<!-- Image -->
				<MotionDiv
					initial={{ opacity: 0, x: section.imageRight ? 32 : -32 }}
					whileInView={{ opacity: 1, x: 0 }}
					inViewOptions={{ once: true }}
					transition={{ duration: 0.6, delay: 0.1 }}
					class="w-full shrink-0 lg:w-1/2"
				>
					<div class="overflow-hidden rounded-2xl border border-base-300">
						<img
							src={section.image}
							alt={section.imageAlt}
							class="h-72 w-full object-cover transition-transform duration-700 hover:scale-105 lg:h-96"
						/>
					</div>
				</MotionDiv>

				<!-- Text -->
				<MotionDiv
					initial={{ opacity: 0, x: section.imageRight ? -32 : 32 }}
					whileInView={{ opacity: 1, x: 0 }}
					inViewOptions={{ once: true }}
					transition={{ duration: 0.6, delay: 0.2 }}
					class="flex flex-col gap-4"
				>
					<span class="text-xs font-semibold tracking-[0.25em] text-brand-cyan uppercase">
						{section.label}
					</span>
					<h2 class="text-2xl font-black text-base-content md:text-3xl">
						{section.heading}
					</h2>
					<p class="text-base leading-relaxed text-base-content/60">{section.body}</p>

					{#if i === 0}
						<a href="/signup" class="btn mt-2 self-start btn-warning">Get Involved</a>
					{/if}
				</MotionDiv>
			</div>
		</MotionSection>
	{/each}
</div>

<!-- ─── IMPACT STATS ──────────────────────────────────────────────────────── -->
<MotionSection
	initial={{ opacity: 0 }}
	whileInView={{ opacity: 1 }}
	inViewOptions={{ once: true }}
	transition={{ duration: 0.6 }}
	class="border-y border-base-300 bg-base-200"
>
	<div class="mx-auto max-w-5xl px-4 py-16 md:px-6">
		<div class="mb-10 text-center">
			<p class="text-xs font-semibold tracking-[0.3em] text-brand-gold uppercase">By the Numbers</p>
		</div>
		<div class="grid grid-cols-1 gap-8 text-center sm:grid-cols-3">
			{#each [{ value: '500+', label: 'Students Reached', color: 'text-brand-gold' }, { value: '20+', label: 'Community Events', color: 'text-brand-cyan' }, { value: '10+', label: 'Partner Schools', color: 'text-base-content' }] as stat, i}
				<MotionDiv
					initial={{ opacity: 0, y: 20 }}
					whileInView={{ opacity: 1, y: 0 }}
					inViewOptions={{ once: true }}
					transition={{ duration: 0.45, delay: i * 0.1 }}
				>
					<p class="text-5xl font-black {stat.color}">{stat.value}</p>
					<p class="mt-2 text-xs font-semibold tracking-widest text-base-content/50 uppercase">
						{stat.label}
					</p>
				</MotionDiv>
			{/each}
		</div>
	</div>
</MotionSection>

<!-- ─── HOST US CTA ───────────────────────────────────────────────────────── -->
<MotionDiv
	initial={{ opacity: 0, y: 24 }}
	whileInView={{ opacity: 1, y: 0 }}
	inViewOptions={{ once: true }}
	transition={{ duration: 0.6 }}
	class="bg-base-100 px-4 py-24 text-center"
>
	<div class="mx-auto max-w-xl">
		<div class="card border border-brand-gold/20 bg-base-200 shadow-xl shadow-brand-gold/5">
			<div class="card-body gap-5 py-10">
				<div
					class="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-gold/10"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-7 w-7 text-brand-gold"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.5"
							d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
						/>
					</svg>
				</div>
				<h3 class="text-2xl font-black text-base-content">Host Us at Your School</h3>
				<p class="text-sm leading-relaxed text-base-content/60">
					Want RCCF to bring a robotics workshop to your school, library, or community center? We'd
					love to make it happen. Reach out and let's plan something incredible.
				</p>
				<div class="card-actions justify-center pt-2">
					<a href="mailto:rccf@ucf.edu" class="btn btn-warning"> Email Us to Schedule </a>
				</div>
			</div>
		</div>
	</div>
</MotionDiv>
