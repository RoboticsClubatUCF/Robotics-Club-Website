<script lang="ts">
	import { motion } from 'motion-sv';
	import { page } from '$app/state';

	let { user }: { user: boolean } = $props();

	const MotionDiv = motion.div;

	let menuOpen = $state(false);

	const navLinks = [
		{ href: '/', label: 'Home' },
		{ href: '/projects', label: 'Projects' },
		{ href: '/sponsors', label: 'Sponsors' },
		{ href: '/outreach', label: 'Outreach' }
	];

	function isActive(href: string): boolean {
		if (href === '/') return page.url.pathname === '/';
		return page.url.pathname.startsWith(href);
	}
</script>

<header
	class="fixed top-0 right-0 left-0 z-50 border-b border-brand-gold/20 bg-base-100/85 backdrop-blur-md"
>
	<nav class="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 md:px-6">
		<!-- Logo -->
		<a href="/" class="flex shrink-0 items-center gap-2.5">
			<img
				src="/photos/roboskull_black_large.jpg"
				alt="RCCF"
				class="h-8 w-8 rounded-full border border-brand-gold/40 object-cover"
			/>
			<span class="font-bold tracking-widest text-brand-gold">RCCF</span>
		</a>

		<!-- Desktop nav links -->
		<div class="hidden items-center gap-0.5 md:flex">
			{#each navLinks as link}
				<a
					href={link.href}
					class="rounded-lg px-4 py-2 text-sm font-medium transition-colors duration-150 {isActive(
						link.href
					)
						? 'bg-brand-gold/10 text-brand-gold'
						: 'text-base-content/60 hover:bg-brand-gold/5 hover:text-brand-gold'}"
				>
					{link.label}
				</a>
			{/each}
		</div>

		<!-- Right side actions -->
		<div class="flex items-center gap-2">
			{#if user}
				<a href="/dashboard" class="btn hidden btn-sm btn-warning sm:flex">Dashboard</a>
			{:else}
				<a href="/signin" class="btn hidden btn-ghost btn-sm sm:flex">Sign In</a>
				<a href="/signup" class="btn hidden btn-sm btn-warning sm:flex">Join Us</a>
			{/if}

			<!-- Hamburger -->
			<button
				class="btn btn-square btn-ghost btn-sm md:hidden"
				onclick={() => (menuOpen = !menuOpen)}
				aria-label="Toggle navigation menu"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-5 w-5 transition-transform duration-200 {menuOpen ? 'rotate-90' : ''}"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
				>
					{#if menuOpen}
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M6 18L18 6M6 6l12 12"
						/>
					{:else}
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M4 6h16M4 12h16M4 18h16"
						/>
					{/if}
				</svg>
			</button>
		</div>
	</nav>

	<!-- Mobile dropdown -->
	<MotionDiv
		animate={{ height: menuOpen ? 'auto' : 0, opacity: menuOpen ? 1 : 0 }}
		transition={{ duration: 0.2, ease: 'easeInOut' }}
		class="overflow-hidden border-t border-base-300 bg-base-100 md:hidden"
	>
		<div class="flex flex-col gap-1 px-4 py-4">
			{#each navLinks as link}
				<a
					href={link.href}
					class="rounded-lg px-4 py-3 text-sm font-medium transition-colors {isActive(link.href)
						? 'bg-brand-gold/10 text-brand-gold'
						: 'text-base-content/60 hover:text-base-content'}"
					onclick={() => (menuOpen = false)}
				>
					{link.label}
				</a>
			{/each}
			<div class="divider my-1"></div>
			{#if user}
				<a href="/dashboard" class="btn btn-sm btn-warning" onclick={() => (menuOpen = false)}>
					Dashboard
				</a>
			{:else}
				<div class="flex gap-2">
					<a href="/signin" class="btn flex-1 btn-ghost btn-sm" onclick={() => (menuOpen = false)}>
						Sign In
					</a>
					<a
						href="/signup"
						class="btn flex-1 btn-sm btn-warning"
						onclick={() => (menuOpen = false)}
					>
						Join Us
					</a>
				</div>
			{/if}
		</div>
	</MotionDiv>
</header>
