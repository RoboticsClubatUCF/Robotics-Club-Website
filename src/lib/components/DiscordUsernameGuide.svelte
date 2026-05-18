<script lang="ts">
	let open = $state(false);
	let hideTimer: ReturnType<typeof setTimeout>;

	function show() {
		clearTimeout(hideTimer);
		open = true;
	}

	function hide() {
		hideTimer = setTimeout(() => (open = false), 120);
	}

	function toggle() {
		open = !open;
	}
</script>

<div class="relative inline-flex items-center align-middle" role="group" onmouseenter={show} onmouseleave={hide}>
	<!-- Info icon trigger -->
	<button
		type="button"
		class="flex items-center justify-center p-0 text-base-content/60 transition-colors hover:text-brand-gold focus:outline-none"
		onclick={toggle}
		aria-label="Discord username help"
		aria-expanded={open}
	>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 20 20"
			fill="currentColor"
			class="h-5 w-5"
			aria-hidden="true"
		>
			<path
				fill-rule="evenodd"
				d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.25v2.75a.75.75 0 001.5 0V10a.75.75 0 00-.75-.75H9z"
				clip-rule="evenodd"
			/>
		</svg>
	</button>

	{#if open}
		<!-- Popover -->
		<div
			class="absolute bottom-full left-1/2 z-50 mb-3 w-72 -translate-x-1/2 rounded-xl border border-brand-gold/20 bg-base-200 p-4 shadow-2xl shadow-black/50 transition-all sm:w-96"
			role="tooltip"
			onmouseenter={show}
			onmouseleave={hide}
		>
			<div class="mb-3 flex items-start gap-3">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 20 20"
					fill="currentColor"
					class="mt-0.5 h-5 w-5 shrink-0 text-warning"
					aria-hidden="true"
				>
					<path
						fill-rule="evenodd"
						d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
						clip-rule="evenodd"
					/>
				</svg>
				<p class="text-sm leading-relaxed text-base-content/90">
					Enter your <strong>username</strong>, not your display name.
				</p>
			</div>
			<img
				src="/discord-username-guide.png"
				alt="Discord profile showing display name 'PhiBi' at top and username 'phibiscool' below it"
				class="w-full rounded-lg"
				draggable="false"
			/>
			<!-- Arrow -->
			<div
				class="absolute top-full left-1/2 -mt-px h-3 w-3 -translate-x-1/2 transform-[translateX(-50%)_rotate(45deg)] border-r border-b border-brand-gold/20 bg-base-200 [clip-path:polygon(0%_0%,100%_0%,100%_100%)]"
			></div>
		</div>
	{/if}
</div>
