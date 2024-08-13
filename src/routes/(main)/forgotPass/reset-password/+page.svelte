<script lang="ts">
  import { superForm } from 'sveltekit-superforms/client';
  import type { PageData } from './$types';

  export let data: PageData;

  const { form, errors, constraints } = superForm(data.form, {
    clearOnSubmit: 'errors-and-message'
  });
</script>

<div class="h-screen grid place-items-center">
  <div class="card p-8 shadow-xl">
    <form method="POST" class="p-2 rounded-md">
      <h2 class="h2">Create New Password</h2>
      
      <!-- Hidden token input -->
      <input type="hidden" name="token" value={$form.token} />

      <label class="label m-4">
        <span>New Password</span>
        <input
          placeholder="Enter your new password"
          type="password"
          name="newPassword"
          id="newPassword"
          class="input"
          bind:value={$form.newPassword}
          {...$constraints.newPassword}
          required
        />
        {#if $errors.newPassword}
          <span class="variant-filled-error badge">{$errors.newPassword}</span>
        {/if}
      </label>
      
      <label class="label m-4">
        <span>Confirm Password</span>
        <input
          placeholder="Confirm your new password"
          type="password"
          name="confirmPass"
          id="confirmPass"
          class="input"
          bind:value={$form.confirmPass}
          required
        />
        {#if $errors.confirmPass}
          <span class="variant-filled-error badge">{$errors.confirmPass}</span>
        {/if}
      </label>

      <button class="btn variant-ghost-primary m-4 hover:variant-filled-primary">Submit</button>
    </form>
  </div>
</div>
