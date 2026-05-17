<script lang="ts">
	import { motion } from 'motion-sv';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const MotionDiv = motion.div;
	const MotionSection = motion.section;

	type Tier = 'PROCESSOR_PATRON' | 'CIRCUIT_SUPPORTER' | 'BOLT_BACKER' | 'ALUMINUM_ALLY';

	const tiers: {
		key: Tier;
		label: string;
		subtitle: string;
		accentClass: string;
		barClass: string;
		borderClass: string;
		badgeClass: string;
	}[] = [
		{
			key: 'PROCESSOR_PATRON',
			label: 'Processor Patron',
			subtitle: 'Premier partner — maximum visibility across all club activities',
			accentClass: 'text-brand-gold',
			barClass: 'bg-brand-gold',
			borderClass: 'border-brand-gold/40',
			badgeClass: 'border-brand-gold/50 text-brand-gold bg-brand-gold/5'
		},
		{
			key: 'CIRCUIT_SUPPORTER',
			label: 'Circuit Supporter',
			subtitle: 'Core supporter — featured at events and on digital assets',
			accentClass: 'text-brand-cyan',
			barClass: 'bg-brand-cyan',
			borderClass: 'border-brand-cyan/40',
			badgeClass: 'border-brand-cyan/50 text-brand-cyan bg-brand-cyan/5'
		},
		{
			key: 'BOLT_BACKER',
			label: 'Bolt Backer',
			subtitle: 'Community supporter — acknowledged at every club event',
			accentClass: 'text-orange-400',
			barClass: 'bg-orange-400',
			borderClass: 'border-orange-400/40',
			badgeClass: 'border-orange-400/50 text-orange-400 bg-orange-400/5'
		},
		{
			key: 'ALUMINUM_ALLY',
			label: 'Aluminum Ally',
			subtitle: 'Friend of the club — listed on the website and in newsletters',
			accentClass: 'text-base-content/60',
			barClass: 'bg-base-content/20',
			borderClass: 'border-base-300',
			badgeClass: 'border-base-300 text-base-content/60 bg-base-200'
		}
	];

	function sponsorsForTier(tier: Tier) {
		return data.sponsors.filter((s) => s.tier === tier);
	}
</script>

<!-- ─── HERO ─────────────────────────────────────────────────────────────── -->
<section class="relative overflow-hidden bg-base-100 px-4 py-24 text-center">
	<div class="pointer-events-none absolute inset-0">
		<div
			class="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_0%,rgba(246,198,16,0.04),transparent)]"
		></div>
	</div>

	<MotionDiv
		initial={{ opacity: 0, y: 20 }}
		animate={{ opacity: 1, y: 0 }}
		transition={{ duration: 0.6 }}
	>
		<p class="mb-3 text-xs font-semibold tracking-[0.3em] text-brand-cyan uppercase">
			Partners & Supporters
		</p>
		<h1 class="text-4xl font-black text-base-content md:text-6xl">
			Our <span class="text-brand-gold">Sponsors</span>
		</h1>
		<p class="mx-auto mt-5 max-w-xl text-base leading-relaxed text-base-content/60">
			RCCF is made possible by the generosity of industry partners who believe in the next
			generation of robotics engineers.
		</p>
	</MotionDiv>
</section>

<!-- ─── MARQUEE ───────────────────────────────────────────────────────────── -->
{#if data.sponsors.length > 0}
	<MotionDiv
		initial={{ opacity: 0 }}
		animate={{ opacity: 1 }}
		transition={{ duration: 0.6, delay: 0.2 }}
		class="overflow-hidden border-y border-base-300 bg-base-200 py-10"
	>
		<div class="marquee-track flex items-center gap-16 whitespace-nowrap">
			{#each [...data.sponsors, ...data.sponsors] as sponsor}
				<div class="shrink-0">
					{#if sponsor.logo}
						<img
							src={sponsor.logo.url}
							alt={sponsor.logo.alt ?? sponsor.name}
							class="h-10 w-auto max-w-[140px] object-contain opacity-60 grayscale transition-all hover:opacity-100 hover:grayscale-0"
						/>
					{:else}
						<span class="text-sm font-bold text-base-content/40">{sponsor.name}</span>
					{/if}
				</div>
			{/each}
		</div>
	</MotionDiv>
{/if}

<!-- ─── TIER SECTIONS ─────────────────────────────────────────────────────── -->
<div class="mx-auto max-w-7xl px-4 py-20 md:px-6">
	{#each tiers as tier, ti}
		{@const tierSponsors = sponsorsForTier(tier.key)}
		<MotionSection
			initial={{ opacity: 0, y: 32 }}
			whileInView={{ opacity: 1, y: 0 }}
			inViewOptions={{ once: true }}
			transition={{ duration: 0.55, delay: ti * 0.05 }}
			class="mb-16 last:mb-0"
		>
			<!-- Tier header -->
			<div class="mb-8 flex items-start gap-4">
				<div class="h-10 w-1 rounded-full {tier.barClass} mt-1 shrink-0"></div>
				<div>
					<div class="flex flex-wrap items-center gap-3">
						<h2 class="text-2xl font-black {tier.accentClass}">{tier.label}</h2>
						<span class="badge badge-sm {tier.badgeClass}"
							>{tierSponsors.length} sponsor{tierSponsors.length !== 1 ? 's' : ''}</span
						>
					</div>
					<p class="mt-1 text-sm text-base-content/50">{tier.subtitle}</p>
				</div>
			</div>

			{#if tierSponsors.length > 0}
				<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
					{#each tierSponsors as sponsor, i}
						<MotionDiv
							initial={{ opacity: 0, scale: 0.9 }}
							whileInView={{ opacity: 1, scale: 1 }}
							inViewOptions={{ once: true }}
							transition={{ duration: 0.35, delay: i * 0.06 }}
							whileHover={{ y: -4, scale: 1.04 }}
						>
							<a
								href={sponsor.websiteUrl ?? '#'}
								target={sponsor.websiteUrl ? '_blank' : undefined}
								rel="noopener noreferrer"
								class="card border bg-base-200 {tier.borderClass} flex h-full flex-col items-center justify-center gap-3 p-6 transition-colors hover:border-brand-gold/40"
							>
								{#if sponsor.logo}
									<img
										src={sponsor.logo.url}
										alt={sponsor.logo.alt ?? sponsor.name}
										class="h-14 w-full max-w-[120px] object-contain"
									/>
								{/if}
								<p class="text-center text-xs leading-snug font-semibold text-base-content/70">
									{sponsor.name}
								</p>
							</a>
						</MotionDiv>
					{/each}
				</div>
			{:else}
				<div class="rounded-xl border border-dashed border-base-300 py-10 text-center">
					<p class="text-sm text-base-content/30">No {tier.label} sponsors yet</p>
				</div>
			{/if}
		</MotionSection>
	{/each}
</div>

<!-- ─── SPONSORSHIP CTA ────────────────────────────────────────────────────── -->
<MotionDiv
	initial={{ opacity: 0, y: 24 }}
	whileInView={{ opacity: 1, y: 0 }}
	inViewOptions={{ once: true }}
	transition={{ duration: 0.6 }}
	class="border-t border-base-300 bg-base-200 px-4 py-20 text-center"
>
	<div class="mx-auto max-w-2xl">
		<p class="mb-3 text-xs font-semibold tracking-[0.3em] text-brand-cyan uppercase">
			Partner With Us
		</p>
		<h2 class="text-3xl font-black text-base-content md:text-4xl">
			Invest in the Next Generation of <span class="text-brand-gold">Engineers</span>
		</h2>
		<p class="mx-auto mt-5 max-w-lg text-sm leading-relaxed text-base-content/60">
			Sponsoring RCCF connects your brand with talented UCF students actively entering the robotics
			and engineering workforce. Reach out to discuss partnership opportunities.
		</p>
		<div class="mt-8 flex flex-wrap items-center justify-center gap-4">
			<a href="mailto:rccf@ucf.edu" class="btn btn-lg btn-warning"> Get Sponsorship Info </a>
			<a href="/signup" class="btn btn-ghost btn-lg"> Explore Our Work → </a>
		</div>
	</div>
</MotionDiv>
