<script lang="ts">
  import { modeCurrent } from '@skeletonlabs/skeleton';
  import type { PageData } from './$types';
  import { superForm } from 'sveltekit-superforms';
  export let data: PageData;

  const { form, errors, constraints, enhance } = superForm(data.form, {
    clearOnSubmit: 'errors-and-message'
  });
</script>

<div class="min-h-screen flex items-center justify-center absolute w-full top-0 pointer-events-none px-4 py-12">
  <div
    class={$modeCurrent
      ? 'block card p-8 sm:p-10 pointer-events-auto shadow-xl shadow-surface-300 w-full max-w-sm'
      : 'block card p-8 sm:p-10 pointer-events-auto shadow-xl shadow-surface-500 w-full max-w-sm'}
  >
    <form method="POST" use:enhance class="flex flex-col gap-6">
      <div>
        <h2 class="h2 mb-1">Sign In</h2>
        <p class="text-sm opacity-60">Welcome back. Enter your credentials to continue.</p>
      </div>

      <div class="flex flex-col gap-4">
        <label class="label">
          <span class="text-sm font-medium">Email</span>
          <input
            type="email"
            name="email"
            id="email"
            class="input mt-1"
            bind:value={$form.email}
            {...$constraints.email}
            autocomplete="email"
            placeholder="you@example.com"
          />
          {#if $errors.email}
            <p class="text-sm text-error-500 mt-1">{$errors.email}</p>
          {/if}
        </label>

        <label class="label">
          <div class="flex justify-between items-center mb-1">
            <span class="text-sm font-medium">Password</span>
            <a href="/forgotPass" class="text-xs opacity-60 hover:opacity-100 transition-opacity">
              Forgot password?
            </a>
          </div>
          <input
            type="password"
            name="password"
            id="password"
            class="input"
            bind:value={$form.password}
            {...$constraints.password}
            autocomplete="current-password"
            placeholder="••••••••"
          />
          {#if $errors.password}
            <p class="text-sm text-error-500 mt-1">{$errors.password}</p>
          {/if}
        </label>
      </div>

      <button type="submit" class="btn variant-ghost-primary hover:variant-filled-primary w-full">Sign In</button>

      <p class="text-sm text-center opacity-60">
        Don't have an account?
        <a href="/register" class="opacity-100 font-medium underline underline-offset-2">Sign up</a>
      </p>
    </form>
  </div>
</div>
