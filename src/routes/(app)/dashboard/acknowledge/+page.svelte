<script lang="ts">
  import { enhance } from '$app/forms';
  import { modeCurrent } from '@skeletonlabs/skeleton';
  import type { PageData, ActionData } from './$types';
  import Payments from '../../../../components/stripe/payments.svelte';
  import DiscordUsernameInfo from '../../../../components/DiscordUsernameInfo.svelte';

  export let data: PageData;
  export let form: ActionData;

  let agreed = false;
  let showPayment = false;
  let editing = false;
  let editMessage = data.message;

  $: if (form?.success) {
    editing = false;
    editMessage = data.message;
  }
</script>

<div class="m-6 max-w-2xl mx-auto">

  <!-- Officer edit bar -->
  {#if data.isOfficer}
    <div class="mb-4 flex items-center gap-3">
      <span class="text-xs opacity-50 uppercase tracking-wide">Officer tools</span>
      {#if !editing}
        <button
          class="btn btn-sm variant-ghost-warning hover:variant-filled-warning"
          on:click={() => { editing = true; editMessage = data.message; }}
        >
          Edit Acknowledgement Message
        </button>
      {:else}
        <span class="text-xs opacity-60">Editing message...</span>
      {/if}
    </div>
  {/if}

  <!-- Edit form (officers only) -->
  {#if editing}
    <div class={$modeCurrent
      ? 'card p-6 mb-6 shadow-md shadow-surface-300'
      : 'card p-6 mb-6 shadow-md shadow-surface-500'}>
      <h3 class="h4 mb-3">Edit Acknowledgement Message</h3>
      <form
        method="post"
        action="?/update"
        use:enhance={() => ({ update }) => update({ reset: false })}
      >
        <textarea
          name="message"
          class="textarea w-full font-mono text-sm mb-3"
          rows="8"
          bind:value={editMessage}
          placeholder="Enter the acknowledgement message members will read before paying dues..."
        ></textarea>
        {#if form?.error}
          <p class="text-error-500 text-sm mb-2">{form.error}</p>
        {/if}
        <div class="flex gap-2">
          <button type="submit" class="btn btn-sm variant-filled-primary">Save</button>
          <button
            type="button"
            class="btn btn-sm variant-ghost-surface"
            on:click={() => { editing = false; editMessage = data.message; }}
          >Cancel</button>
        </div>
      </form>
    </div>
  {/if}

  <!-- Main acknowledgement card -->
  <div class={$modeCurrent
    ? 'card p-8 shadow-md shadow-surface-300'
    : 'card p-8 shadow-md shadow-surface-500'}>

    {#if !showPayment}
      <h2 class="h2 mb-1">Membership Agreement</h2>
      <p class="text-sm opacity-60 mb-6">Please read and agree before proceeding to payment.</p>

      <!-- Editable acknowledgement message -->
      <div class="prose max-w-none mb-6 p-4 rounded-lg bg-surface-100-800-token border border-surface-300-600-token whitespace-pre-wrap leading-relaxed">
        {data.message}
      </div>

      <!-- Discord username callout -->
      <aside class="mb-6 p-4 rounded-lg border border-warning-500/40 bg-warning-500/10 flex gap-3">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"
          class="w-5 h-5 shrink-0 mt-0.5 text-warning-500" aria-hidden="true">
          <path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd"/>
        </svg>
        <div class="text-sm leading-relaxed">
          <p>
            During registration your <strong>Discord Username</strong> is required. This is the handle located <strong>BELOW</strong>
            your display name (see ⓘ for visual aid).
            <DiscordUsernameInfo />
          </p>
        </div>
      </aside>

      <!-- I agree checkbox -->
      <label class="flex items-start gap-3 cursor-pointer mb-6 select-none">
        <input
          type="checkbox"
          class="checkbox mt-0.5 shrink-0"
          bind:checked={agreed}
        />
        <span class="text-sm leading-snug">
          I have read and agree to the above terms, and confirm that I have provided my correct Discord <strong>Username</strong>.
        </span>
      </label>

      <form
        method="post"
        action="?/confirm"
        use:enhance={() => async ({ result, update }) => {
          await update({ reset: false });
          if (result.type === 'success') showPayment = true;
        }}
      >
        <button type="submit" class="btn variant-filled-primary" disabled={!agreed}>
          Continue to Payment
        </button>
      </form>

    {:else}
      <!-- Payment section -->
      <button
        class="btn btn-sm variant-ghost-surface mb-6"
        on:click={() => showPayment = false}
      >
        ← Back
      </button>
      <Payments userID={data.memberId} />
    {/if}
  </div>
</div>
