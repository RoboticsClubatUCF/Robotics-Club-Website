<script lang="ts">
	import { motion } from 'motion-sv';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const MotionDiv = motion.div;
	const MotionImg = motion.img;
	const MotionA = motion.a;
	const MotionSection = motion.section;

	const whatWeDo = [
		{
			title: 'Our Mission',
			description:
				'Inspiring engineers, designers, and thinkers to build the machines of tomorrow — together.',
			image: '/photos/mission_statement.png',
			href: '/outreach'
		},
		{
			title: 'Projects',
			description:
				'Autonomous vehicles, drones, robotic arms, and more. Every semester brings new challenges.',
			image: '/photos/projects.png',
			href: '/projects'
		},
		{
			title: 'Teaching',
			description:
				'From soldering to ROS — member-led workshops help everyone level up their skills.',
			image: '/photos/teaching.png',
			href: '/outreach'
		},
		{
			title: 'Outreach',
			description:
				'Bringing hands-on STEM to K-12 students and underserved communities across Central Florida.',
			image: '/photos/outreach.png',
			href: '/outreach'
		},
		{
			title: 'Competition',
			description:
				'We compete regionally and nationally, putting our engineering against the best teams in the country.',
			image: '/photos/competition.png',
			href: '/projects'
		},
		{
			title: 'Research',
			description: 'Collaborating with UCF faculty on cutting-edge robotics and AI research.',
			image: '/photos/research.png',
			href: '/projects'
		}
	];

	const officers = [
		{ name: 'President', role: 'Club President', photo: '/photos/President.jpg' },
		{ name: 'Vice President', role: 'Vice President', photo: '/photos/VP.jpg' },
		{ name: 'Secretary', role: 'Secretary', photo: '/photos/Secretary.jpg' },
		{ name: 'Treasurer', role: 'Treasurer', photo: '/photos/Treasure.jpg' },
		{ name: 'Operations', role: 'Operations Manager', photo: '/photos/Manager.jpg' },
		{ name: 'Marketing', role: 'Marketing Lead', photo: '/photos/Marketing.jpg' },
		{ name: 'Outreach', role: 'Outreach Coordinator', photo: '/photos/Outreach.jpg' },
		{ name: 'Crystal', role: 'Officer', photo: '/photos/Crytal1.jpg' }
	];

	const faqs = [
		{
			q: 'When and where does RCCF meet?',
			a: 'We meet weekly on campus. Join our Discord to get the current room location and schedule.'
		},
		{
			q: 'How do I join the Robotics Club?',
			a: "Create an account on this site, pay your membership dues, and you're in. You'll get access to all projects and our Discord server."
		},
		{
			q: 'How much are membership dues?',
			a: 'Dues are $20 per semester. Financial hardship waivers are available — reach out to an officer.'
		},
		{
			q: 'Do I need prior experience?',
			a: 'None at all. We welcome everyone from complete beginners to seasoned engineers. The only requirement is curiosity.'
		},
		{
			q: 'What kind of projects can I work on?',
			a: 'Autonomous ground vehicles, aerial drones, robotic arms, computer vision systems, and more. New projects kick off every semester.'
		},
		{
			q: 'Is RCCF only for engineering majors?',
			a: 'Not even close. We have members from CS, ECE, ME, art, business, and beyond. Robotics is interdisciplinary — everyone contributes.'
		}
	];

	const stats = $derived([
		{
			value: Math.floor(data.projectCount / 10) * 10 + '+',
			label: 'Active Projects',
			color: 'text-brand-gold'
		},
		{
			value: Math.floor(data.memberCount / 10) * 10 + '+',
			label: 'Club Members',
			color: 'text-brand-cyan'
		},
		{ value: '1972', label: 'Founded', color: 'text-base-content' }
	]);
</script>

<!-- ─── HERO ─────────────────────────────────────────────────────────────── -->
<section
	class="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-base-100 px-4 text-center"
>
	<!-- Decorative grid lines -->
	<div class="pointer-events-none absolute inset-0">
		<div class="absolute top-1/4 right-0 left-0 h-px bg-brand-gold/8"></div>
		<div class="absolute right-0 bottom-1/4 left-0 h-px bg-brand-cyan/8"></div>
		<div class="absolute top-0 bottom-0 left-1/3 w-px bg-brand-gold/5"></div>
		<div class="absolute top-0 right-1/3 bottom-0 w-px bg-brand-cyan/5"></div>
		<!-- Corner accent marks -->
		<div class="absolute top-8 left-8 h-8 w-8 border-t-2 border-l-2 border-brand-gold/30"></div>
		<div class="absolute top-8 right-8 h-8 w-8 border-t-2 border-r-2 border-brand-gold/30"></div>
		<div class="absolute bottom-8 left-8 h-8 w-8 border-b-2 border-l-2 border-brand-cyan/30"></div>
		<div class="absolute right-8 bottom-8 h-8 w-8 border-r-2 border-b-2 border-brand-cyan/30"></div>
	</div>

	<!-- Roboskull — entrance fade then continuous float -->
	<MotionDiv
		initial={{ opacity: 0, scale: 0.7 }}
		animate={{ opacity: 1, scale: 1 }}
		transition={{ duration: 0.7, ease: 'easeOut' }}
		class="mb-8"
	>
		<MotionImg
			src="/photos/roboskull_black_large.jpg"
			alt="RCCF Mascot"
			class="h-36 w-36 rounded-full border-2 border-brand-gold/40 object-cover shadow-2xl shadow-brand-gold/10 md:h-52 md:w-52"
		/>
	</MotionDiv>

	<!-- Headline -->
	<MotionDiv
		initial={{ opacity: 0, y: 30 }}
		animate={{ opacity: 1, y: 0 }}
		transition={{ duration: 0.7, delay: 0.2 }}
	>
		<h1 class="text-5xl font-black tracking-tight text-brand-gold md:text-7xl lg:text-8xl">
			ROBOTICS
			<span class="block text-base-content">CLUB</span>
		</h1>
	</MotionDiv>

	<!-- Subtitle -->
	<MotionDiv
		initial={{ opacity: 0, y: 20 }}
		animate={{ opacity: 1, y: 0 }}
		transition={{ duration: 0.6, delay: 0.45 }}
		class="mt-4"
	>
		<p class="text-base font-medium tracking-[0.3em] text-brand-cyan md:text-lg">
			UNIVERSITY OF CENTRAL FLORIDA
		</p>
	</MotionDiv>

	<!-- CTAs -->
	<MotionDiv
		initial={{ opacity: 0, y: 20 }}
		animate={{ opacity: 1, y: 0 }}
		transition={{ duration: 0.6, delay: 0.65 }}
		class="mt-10 flex flex-wrap items-center justify-center gap-4"
	>
		<a href="/signup" class="btn shadow-lg shadow-brand-gold/20 btn-lg btn-warning">
			Join the Club
		</a>
		<a
			href="/projects"
			class="btn border-brand-cyan text-brand-cyan btn-outline btn-lg hover:bg-brand-cyan hover:text-base-100"
		>
			View Projects
		</a>
	</MotionDiv>

	<!-- Scroll indicator -->
	<MotionDiv
		class="absolute bottom-8 left-1/2 -translate-x-1/2"
		animate={{ y: [0, 8, 0] }}
		transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
		initial={{ opacity: 0 }}
	>
		<MotionDiv
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			transition={{ delay: 1.2, duration: 0.6 }}
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-6 w-6 text-base-content/30"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="1.5"
					d="M19 9l-7 7-7-7"
				/>
			</svg>
		</MotionDiv>
	</MotionDiv>
</section>

<!-- ─── STATS ─────────────────────────────────────────────────────────────── -->
<MotionSection
	initial={{ opacity: 0 }}
	whileInView={{ opacity: 1 }}
	inViewOptions={{ once: true }}
	transition={{ duration: 0.6 }}
	class="border-y border-base-300 bg-base-200"
>
	<div class="mx-auto max-w-5xl px-4 py-14 md:px-6">
		<div class="grid grid-cols-1 gap-8 text-center sm:grid-cols-3">
			{#each stats as stat, i}
				<MotionDiv
					initial={{ opacity: 0, y: 24 }}
					whileInView={{ opacity: 1, y: 0 }}
					inViewOptions={{ once: true }}
					transition={{ duration: 0.5, delay: i * 0.12 }}
				>
					<p class="text-5xl font-black {stat.color} md:text-6xl">{stat.value}</p>
					<p class="mt-2 text-sm font-medium tracking-widest text-base-content/50 uppercase">
						{stat.label}
					</p>
				</MotionDiv>
			{/each}
		</div>
	</div>
</MotionSection>

<!-- ─── WHAT WE DO ─────────────────────────────────────────────────────────── -->
<section class="mx-auto max-w-7xl px-4 py-24 md:px-6">
	<MotionDiv
		initial={{ opacity: 0, y: 20 }}
		whileInView={{ opacity: 1, y: 0 }}
		inViewOptions={{ once: true }}
		transition={{ duration: 0.6 }}
		class="mb-14 text-center"
	>
		<p class="mb-3 text-xs font-semibold tracking-[0.3em] text-brand-cyan uppercase">What We Do</p>
		<h2 class="text-3xl font-black text-base-content md:text-5xl">
			Build. Learn. <span class="text-brand-gold">Compete.</span>
		</h2>
	</MotionDiv>

	<div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
		{#each whatWeDo as card, i}
			<MotionDiv
				initial={{ opacity: 0, y: 32 }}
				whileInView={{ opacity: 1, y: 0 }}
				inViewOptions={{ once: true }}
				transition={{ duration: 0.5, delay: i * 0.08 }}
				whileHover={{ y: -8, scale: 1.02 }}
			>
				<a
					href={card.href}
					class="card block h-full border border-base-300 bg-base-200 transition-colors hover:border-brand-gold/30"
				>
					<figure class="overflow-hidden">
						<img
							src={card.image}
							alt={card.title}
							class="h-44 w-full object-cover transition-transform duration-500 hover:scale-105"
						/>
					</figure>
					<div class="card-body gap-2">
						<h3 class="card-title text-base-content">{card.title}</h3>
						<p class="text-sm leading-relaxed text-base-content/60">{card.description}</p>
					</div>
				</a>
			</MotionDiv>
		{/each}
	</div>
</section>

<!-- ─── SPONSOR MARQUEE ────────────────────────────────────────────────────── -->
{#if data.sponsors && data.sponsors.length > 0}
	<MotionSection
		initial={{ opacity: 0 }}
		whileInView={{ opacity: 1 }}
		inViewOptions={{ once: true }}
		transition={{ duration: 0.7 }}
		class="overflow-hidden border-y border-base-300 bg-base-200 py-12"
	>
		<p
			class="mb-6 text-center text-xs font-semibold tracking-[0.3em] text-base-content/40 uppercase"
		>
			Proudly Supported By
		</p>
		<div class="marquee-track flex items-center gap-12 whitespace-nowrap">
			{#each [...data.sponsors, ...data.sponsors] as sponsor}
				<div class="flex shrink-0 items-center gap-3">
					{#if sponsor.logo}
						<img
							src={sponsor.logo.url}
							alt={sponsor.logo.alt ?? sponsor.name}
							class="h-10 w-auto max-w-[120px] object-contain opacity-70 grayscale transition-all hover:opacity-100 hover:grayscale-0"
						/>
					{:else}
						<span class="text-sm font-semibold text-base-content/50">{sponsor.name}</span>
					{/if}
				</div>
			{/each}
		</div>
	</MotionSection>
{:else}
	<MotionSection
		initial={{ opacity: 0, y: 20 }}
		whileInView={{ opacity: 1, y: 0 }}
		inViewOptions={{ once: true }}
		transition={{ duration: 0.6 }}
		class="border-y border-base-300 bg-base-200 px-4 py-16 text-center"
	>
		<p class="mb-4 text-xs font-semibold tracking-[0.3em] text-base-content/40 uppercase">
			Sponsorship
		</p>
		<h3 class="mb-4 text-2xl font-bold text-base-content">Help Us Build the Future</h3>
		<p class="mx-auto mb-6 max-w-md text-sm text-base-content/60">
			Your support enables students to design, build, and compete with world-class robotics systems.
		</p>
		<a href="/sponsors" class="btn btn-warning">Become a Sponsor</a>
	</MotionSection>
{/if}

<!-- ─── MEET THE TEAM ──────────────────────────────────────────────────────── -->
<section class="mx-auto max-w-7xl px-4 py-24 md:px-6">
	<MotionDiv
		initial={{ opacity: 0, y: 20 }}
		whileInView={{ opacity: 1, y: 0 }}
		inViewOptions={{ once: true }}
		transition={{ duration: 0.6 }}
		class="mb-14 text-center"
	>
		<p class="mb-3 text-xs font-semibold tracking-[0.3em] text-brand-cyan uppercase">Leadership</p>
		<h2 class="text-3xl font-black text-base-content md:text-5xl">
			Meet the <span class="text-brand-gold">Team</span>
		</h2>
	</MotionDiv>

	<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
		{#each officers as officer, i}
			<MotionDiv
				initial={{ opacity: 0, y: 28 }}
				whileInView={{ opacity: 1, y: 0 }}
				inViewOptions={{ once: true }}
				transition={{ duration: 0.45, delay: i * 0.07 }}
				whileHover={{ y: -6, scale: 1.03 }}
				class="card border border-base-300 bg-base-200 transition-colors hover:border-brand-gold/30"
			>
				<div class="card-body items-center gap-3 p-5 text-center">
					<div class="avatar">
						<div class="w-20 rounded-full border-2 border-brand-gold/20">
							<img src={officer.photo} alt={officer.name} class="object-cover" />
						</div>
					</div>
					<div>
						<p class="text-sm font-semibold text-base-content">{officer.name}</p>
						<p class="mt-0.5 text-xs text-base-content/50">{officer.role}</p>
					</div>
				</div>
			</MotionDiv>
		{/each}
	</div>
</section>

<!-- ─── FAQ ───────────────────────────────────────────────────────────────── -->
<section class="border-y border-base-300 bg-base-200">
	<div class="mx-auto max-w-3xl px-4 py-24 md:px-6">
		<MotionDiv
			initial={{ opacity: 0, y: 20 }}
			whileInView={{ opacity: 1, y: 0 }}
			inViewOptions={{ once: true }}
			transition={{ duration: 0.6 }}
			class="mb-12 text-center"
		>
			<p class="mb-3 text-xs font-semibold tracking-[0.3em] text-brand-cyan uppercase">FAQ</p>
			<h2 class="text-3xl font-black text-base-content md:text-4xl">
				Got <span class="text-brand-gold">Questions?</span>
			</h2>
		</MotionDiv>

		<div class="flex flex-col gap-3">
			{#each faqs as faq, i}
				<MotionDiv
					initial={{ opacity: 0, x: -20 }}
					whileInView={{ opacity: 1, x: 0 }}
					inViewOptions={{ once: true }}
					transition={{ duration: 0.4, delay: i * 0.06 }}
				>
					<details
						class="collapse-arrow collapse border border-base-300 bg-base-100 transition-colors hover:border-brand-gold/30"
					>
						<summary class="collapse-title text-sm font-semibold text-base-content">{faq.q}</summary
						>
						<div class="collapse-content">
							<p class="pt-1 text-sm leading-relaxed text-base-content/60">{faq.a}</p>
						</div>
					</details>
				</MotionDiv>
			{/each}
		</div>
	</div>
</section>

<!-- ─── JOIN CTA ───────────────────────────────────────────────────────────── -->
<MotionSection
	initial={{ opacity: 0 }}
	whileInView={{ opacity: 1 }}
	inViewOptions={{ once: true }}
	transition={{ duration: 0.7 }}
	class="relative overflow-hidden bg-base-100 px-4 py-28 text-center"
>
	<!-- Background accent -->
	<div class="pointer-events-none absolute inset-0">
		<div
			class="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_50%,rgba(246,198,16,0.05),transparent)]"
		></div>
	</div>

	<MotionDiv
		initial={{ opacity: 0, y: 24 }}
		whileInView={{ opacity: 1, y: 0 }}
		inViewOptions={{ once: true }}
		transition={{ duration: 0.6, delay: 0.1 }}
	>
		<p class="mb-4 text-xs font-semibold tracking-[0.3em] text-brand-cyan uppercase">
			Get Involved
		</p>
		<h2 class="text-4xl font-black text-base-content md:text-6xl">
			Ready to Build the <span class="text-brand-gold">Future?</span>
		</h2>
		<p class="mx-auto mt-6 max-w-lg text-base leading-relaxed text-base-content/60">
			Join hundreds of students designing, coding, and competing on real robotics systems at UCF.
		</p>

		<div class="mt-10 flex flex-wrap items-center justify-center gap-4">
			<MotionA
				href="https://discord.gg/rccf"
				target="_blank"
				rel="noopener noreferrer"
				class="btn border-0 bg-[#5865F2] text-white btn-lg hover:bg-[#4752c4]"
				whileHover={{ scale: 1.05 }}
				whilePress={{ scale: 0.97 }}
				transition={{ type: 'spring', stiffness: 400, damping: 20 }}
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="mr-2 h-5 w-5"
					fill="currentColor"
					viewBox="0 0 127.14 96.36"
				>
					<path
						d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z"
					/>
				</svg>
				Join our Discord
			</MotionA>
			<MotionA
				href="/signup"
				class="btn shadow-lg shadow-brand-gold/20 btn-lg btn-warning"
				whileHover={{ scale: 1.05 }}
				whilePress={{ scale: 0.97 }}
				transition={{ type: 'spring', stiffness: 400, damping: 20 }}
			>
				Register Now
			</MotionA>
		</div>
	</MotionDiv>
</MotionSection>
