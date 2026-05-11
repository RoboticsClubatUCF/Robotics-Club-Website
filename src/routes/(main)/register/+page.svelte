<svelte:head>
  <title>Register @ RCCF</title>
</svelte:head>

<script lang="ts">
  import { superForm } from 'sveltekit-superforms';
  import type { PageData } from './$types';
  import { modeCurrent } from '@skeletonlabs/skeleton';
  import DiscordUsernameInfo from '../../../components/DiscordUsernameInfo.svelte';

  export let data: PageData;
  const { form, errors, constraints, enhance } = superForm(data.form, {
    clearOnSubmit: 'errors-and-message'
  });
</script>

<div class="flex justify-center w-full top-0 pointer-events-none mt-[50px] pb-8 px-4">
  <div
    class={$modeCurrent
      ? 'block card p-8 sm:p-10 pointer-events-auto shadow-xl shadow-surface-300 w-full max-w-md'
      : 'block card p-8 sm:p-10 pointer-events-auto shadow-xl shadow-surface-500 w-full max-w-md'}
  >
    <form method="POST" use:enhance class="flex flex-col gap-6">
      <div>
        <h2 class="h2 mb-1">Create an Account</h2>
        <p class="text-sm opacity-60">Join the club. Fill out the details below to get started.</p>
      </div>

      <div class="flex flex-col gap-4">
        <div class="grid grid-cols-2 gap-4">
          <label class="label">
            <span class="text-sm font-medium">First Name</span>
            <input
              class="input mt-1"
              type="text"
              name="fname"
              id="fname"
              bind:value={$form.fname}
              {...$constraints}
              placeholder="Jane"
            />
            {#if $errors.fname}
              <p class="text-sm text-error-500 mt-1">{$errors.fname}</p>
            {/if}
          </label>

          <label class="label">
            <span class="text-sm font-medium">Last Name</span>
            <input
              class="input mt-1"
              type="text"
              name="lname"
              id="lname"
              bind:value={$form.lname}
              {...$constraints}
              placeholder="Doe"
            />
            {#if $errors.lname}
              <p class="text-sm text-error-500 mt-1">{$errors.lname}</p>
            {/if}
          </label>
        </div>

        <label class="label">
          <span class="text-sm font-medium">Email</span>
          <input
            class="input mt-1"
            type="email"
            name="email"
            id="email"
            bind:value={$form.email}
            {...$constraints}
            autocomplete="email"
            placeholder="you@example.com"
          />
          {#if $errors.email}
            <p class="text-sm text-error-500 mt-1">{$errors.email}</p>
          {/if}
        </label>

        <label class="label">
          <span class="text-sm font-medium flex items-center gap-1">
            Discord Username <DiscordUsernameInfo />
          </span>
          <input
            class="input mt-1"
            type="text"
            name="discord"
            id="discord"
            bind:value={$form.discord}
            {...$constraints}
            placeholder="username"
          />
          {#if $errors.discord}
            <p class="text-sm text-error-500 mt-1">{$errors.discord}</p>
          {/if}
        </label>

        <label class="label">
          <span class="text-sm font-medium">Password</span>
          <input
            class="input mt-1"
            type="password"
            name="password"
            id="password"
            bind:value={$form.password}
            {...$constraints}
            autocomplete="new-password"
            placeholder="••••••••"
          />
          {#if $errors.password}
            <p class="text-sm text-error-500 mt-1">{$errors.password}</p>
          {/if}
        </label>

        <label class="label">
          <span class="text-sm font-medium">Confirm Password</span>
          <input
            class="input mt-1"
            type="password"
            name="confirmPassword"
            id="confirmPassword"
            bind:value={$form.confirmPassword}
            {...$constraints}
            autocomplete="new-password"
            placeholder="••••••••"
          />
          {#if $errors.confirmPassword}
            <p class="text-sm text-error-500 mt-1">{$errors.confirmPassword}</p>
          {/if}
        </label>
      </div>

      <button type="submit" class="btn variant-ghost-primary hover:variant-filled-primary w-full">Create Account</button>

      <p class="text-sm text-center opacity-60">
        Already have an account?
        <a href="/login" class="opacity-100 font-medium underline underline-offset-2">Sign in</a>
      </p>
    </form>
  </div>
</div>
