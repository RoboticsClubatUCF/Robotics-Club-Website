<script lang="ts">
  import { modeCurrent } from '@skeletonlabs/skeleton';
  import type { PageData } from './$types';
  import { superForm } from 'sveltekit-superforms/client';
  import { onMount } from 'svelte';

  export let data: PageData;

  const { form, errors, constraints } = superForm(data.form, {
    clearOnSubmit: 'errors-and-message'
  });

  let remainingTime = data.remainingTime || 0;
  let timer: string | number | NodeJS.Timer | undefined;

  onMount(() => {
    if (remainingTime > 0) {
      timer = setInterval(() => {
        if (remainingTime > 0) {
          remainingTime--;
        } else {
          clearInterval(timer);
          // Optionally, trigger a refresh or other UI update to show the form again
        }
      }, 1000);
    }
  });

  $: if (remainingTime <= 0 && timer) {
    clearInterval(timer);
  }
</script>

<!-- Form that provides a login screen, followed by the option to create your own account -->
<div class="h-screen grid place-items-center absolute w-screen top-0 pointer-events-none">
  <div
    class={$modeCurrent
      ? 'block card p-8 pointer-events-auto shadow-xl shadow-surface-300'
      : 'block card p-8 pointer-events-auto shadow-xl shadow-surface-500'}
  >
    {#if remainingTime > 0}
      <p>There is already an existing reset request. You can request another reset after:</p>
      <h2 class="h2">{Math.floor(remainingTime / 60)}:{remainingTime % 60}</h2>
    {:else}
      <form method="POST" class="p-2 rounded-md">
        <h2 class="h2">Reset Password</h2>
        <label class="label m-4">
          <span>Email</span>
          <input
            placeholder="supercool@rccf.club"
            type="email"
            name="email"
            id="email"
            class="input"
            bind:value={$form.email}
            {...$constraints.email}
            required
          />
          {#if $errors.email}
            <span class="variant-filled-error badge">{$errors.email}</span>
          {/if}
        </label>
        <button class="btn variant-ghost-primary m-4 hover:variant-filled-primary"
          >Send Request</button
        >
      </form>
    {/if}
  </div>
</div>
