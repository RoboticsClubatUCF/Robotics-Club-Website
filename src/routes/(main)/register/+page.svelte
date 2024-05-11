<script lang="ts">
  import { superForm } from 'sveltekit-superforms/client';
  import type { PageData } from './$types';
  import { onMount } from 'svelte';
  import { injectDots } from '../../../components/pixijs/dotsAnimation';
  import { modeCurrent } from '@skeletonlabs/skeleton';

  export let data: PageData;
  const { form, errors, constraints } = superForm(data.form, {
    clearOnSubmit: 'errors-and-message'
  });

  let mainEle: HTMLElement;
  onMount(() => {
    injectDots(mainEle, 200);
  });
</script>

<div
  bind:this={mainEle}
  class="absolute top-20 left-0 right-0 bottom-0 pointer-events-auto -z-20"
/>
<div class="h-screen grid place-items-center absolute w-screen top-0 pointer-events-none" style="margin-top: 130px; padding-bottom: 130px;">
  <div
    class={$modeCurrent
      ? 'block card p-8 pointer-events-auto shadow-xl shadow-surface-300'
      : 'block card p-8 pointer-events-auto shadow-xl shadow-surface-500'}
  >
    <form method="POST" class="p-2 rounded-md">
      <h2 class="h2">Make an Account</h2>
      <label class="label">
        <span>First Name</span>
        <input
          class="input"
          type="text"
          name="fname"
          id="fname"
          bind:value={$form.fname}
          {...$constraints}
          required
        />
        {#if $errors.fname}
          <span class="variant-filled-error badge">{$errors.fname}</span>
        {/if}
      </label>
      <br />
      <label class="label">
        <span>Last Name</span>
        <input
          class="input"
          type="text"
          name="lname"
          id="lname"
          bind:value={$form.lname}
          {...$constraints}
          required
        />
        {#if $errors.lname}
          <span class="variant-filled-error badge">{$errors.lname}</span>
        {/if}
      </label>
      <br />
      <label class="label">
        <span>Email</span>
        <input
          class="input"
          type="email"
          name="email"
          id="email"
          bind:value={$form.email}
          {...$constraints}
          required
          autocomplete="email"
        />
        {#if $errors.email}
          <span class="variant-filled-error badge">{$errors.email}</span>
        {/if}
      </label>
      <br />
      <label class="label">
        <span>Discord Username</span>
        <input
          class="input"
          type="text"
          name="discord"
          id="discord"
          bind:value={$form.discord}
          {...$constraints}
          required
        />
        {#if $errors.discord}
          <span class="variant-filled-error badge">{$errors.discord}</span>
        {/if}
      </label>
      <br />
      <label class="label">
        <span>Password</span>
        <input
          class="input"
          type="password"
          name="password"
          id="password"
          bind:value={$form.password}
          {...$constraints}
          required
          autocomplete="password"
        />
      </label>
      {#if $errors.password}
        <span class="variant-filled-error badge">{$errors.password}</span>
      {/if}
      <br />
      <label class="label">
        <span>Confirm Password</span>
        <input
          class="input"
          type="password"
          name="confirmPassword"
          id="confirmPassword"
          bind:value={$form.confirmPassword}
          {...$constraints}
          required
        />
      </label>
      {#if $errors.confirmPassword}
        <span class="variant-filled-error badge">{$errors.confirmPassword}</span>
      {/if}
      <br />
      <button class="btn variant-ghost-primary mt-4 hover:variant-filled-primary">Sign Up</button>
    </form>
  </div>
</div>
