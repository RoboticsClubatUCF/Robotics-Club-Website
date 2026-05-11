<script lang="ts">
  let open = false;
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

<span class="discord-info" role="group" on:mouseenter={show} on:mouseleave={hide}>
  <!-- Info icon trigger -->
  <button
    type="button"
    class="info-btn"
    on:click={toggle}
    aria-label="Discord username help"
    aria-expanded={open}
  >
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true">
      <circle cx="10" cy="10" r="9" stroke="currentColor" stroke-width="1.5" fill="none" />
      <text x="10" y="14.5" text-anchor="middle" font-size="11" font-weight="bold" fill="currentColor" font-family="serif">i</text>
    </svg>
  </button>

  {#if open}
    <!-- Popover -->
    <div
      class="popover"
      role="tooltip"
      on:mouseenter={show}
      on:mouseleave={hide}
    >
      <p class="warning-text">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="warn-icon" aria-hidden="true">
          <path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" />
        </svg>
        <span>Enter your <strong>username</strong>, not your display name.</span>
      </p>
      <img
        src="/discord-username-guide.png"
        alt="Discord profile showing display name 'PhiBi' at top and username 'phibiscool' below it"
        class="guide-img"
        draggable="false"
      />
    </div>
  {/if}
</span>

<style>
  .discord-info {
    position: relative;
    display: inline-flex;
    align-items: center;
    vertical-align: middle;
    margin-left: 0.35rem;
  }

  .info-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    background: none;
    border: none;
    cursor: pointer;
    color: rgba(148, 163, 184, 0.85);
    border-radius: 9999px;
    transition: color 0.15s ease;
    line-height: 1;
  }

  .info-btn:hover,
  .info-btn:focus-visible {
    color: rgba(99, 102, 241, 1);
    outline: none;
  }

  .popover {
    position: absolute;
    left: 50%;
    top: calc(100% + 10px);
    transform: translateX(-50%);
    z-index: 50;
    width: 420px;
    background: #1e1f22;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.75rem;
    padding: 1rem;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
    animation: pop-in 0.15s ease;
  }

  /* small arrow pointing up */
  .popover::before {
    content: '';
    position: absolute;
    top: -6px;
    left: 50%;
    transform: translateX(-50%);
    width: 10px;
    height: 6px;
    background: #1e1f22;
    clip-path: polygon(50% 0%, 0% 100%, 100% 100%);
  }

  .warning-text {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    font-size: 1rem;
    color: #fbbf24;
    margin-bottom: 0.75rem;
    line-height: 1.4;
  }

  .warn-icon {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    color: #fbbf24;
    margin-top: 0.1rem;
  }

  .guide-img {
    width: 100%;
    border-radius: 0.5rem;
    display: block;
    user-select: none;
  }

  @keyframes pop-in {
    from { opacity: 0; transform: translateX(-50%) translateY(-4px); }
    to   { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
</style>
