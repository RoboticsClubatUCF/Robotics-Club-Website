<script lang="ts">
  import { modeCurrent } from '@skeletonlabs/skeleton';
  import type { PageData } from './$types';
  import { superForm } from 'sveltekit-superforms/client';
  export let data: PageData;

  const { form, errors, constraints } = superForm(data.form, {
    clearOnSubmit: 'errors-and-message'
  });
</script>

<!-- Form that provides a login screen, followed by the option to create your own account -->
<div class="h-screen grid place-items-center absolute w-screen top-0 pointer-events-none">
  <div
    class={$modeCurrent
      ? 'block card p-8 pointer-events-auto shadow-xl shadow-surface-300'
      : 'block card p-8 pointer-events-auto shadow-xl shadow-surface-500'}
  >
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
      <label class="label m-4">
        <span>First Name</span>
        <input
          type="text"
          name="first"
          id="first"
          class="input"
          bind:value={$form.first}
          {...$constraints.first}
          required
        />
        {#if $errors.first}
          <span class="variant-filled-error badge">{$errors.first}</span>
        {/if}
      </label>
      <label class="label m-4">
        <span>New Password</span>
        <input
          placeholder="A more secure or *cough* rememberable password"
          type="password"
          name="newPass"
          id="newPass"
          class="input"
          bind:value={$form.newPass}
          {...$constraints.newPass}
          required
        />
        {#if $errors.newPass}
          <span class="variant-filled-error badge">{$errors.newPass}</span>
        {/if}
      </label>
      <button class="btn variant-ghost-primary m-4 hover:variant-filled-primary"
        >Reset Password</button
      >
    </form>
  </div>
</div>
