<script lang="ts">
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import { modeCurrent, LightSwitch } from '@skeletonlabs/skeleton';
  import { superForm } from 'sveltekit-superforms';
  import SignoutButton from '../../../../components/buttons/signout-button.svelte';
  import ProfilePic from '../../../../components/profilePic.svelte';
  import type { PageData } from './$types';
  import successToast from '../../../../components/toasts/successToast';
  import DiscordUsernameInfo from '../../../../components/DiscordUsernameInfo.svelte';

  export let data: PageData;
  export let params: Record<string, string>;

  $: fullName = `${data.user?.firstName ?? ''}${data.user?.lastName ? ' ' + data.user.lastName : ''}`;
  let deleteConfirm1 = '';
  let deleteConfirm2 = '';
  $: deleteReady = deleteConfirm1 === fullName && deleteConfirm2 === fullName && fullName.length > 0;

  const originalDiscordName = data.form.data.discordProfileName;
  const { form, constraints, enhance, errors, message } = superForm(data.form, {
    resetForm: false,
    onSubmit: () => {
      if ($form.discordProfileName !== originalDiscordName) {
        startCooldown();
      }
    }
  });

  const COOLDOWN_KEY = 'profile_update_cooldown';
  let cooldownRemaining = 0;
  let cooldownTimer: ReturnType<typeof setInterval> | null = null;

  onMount(() => {
    const stored = browser ? localStorage.getItem(COOLDOWN_KEY) : null;
    if (stored) {
      const until = Number(stored);
      if (until > Date.now()) {
        runCooldownFrom(until);
      } else {
        localStorage.removeItem(COOLDOWN_KEY);
      }
    }
  });

  function startCooldown() {
    const until = Date.now() + 30000;
    if (browser) localStorage.setItem(COOLDOWN_KEY, String(until));
    runCooldownFrom(until);
  }

  function runCooldownFrom(until: number) {
    if (cooldownTimer) clearInterval(cooldownTimer);
    cooldownRemaining = Math.max(0, Math.ceil((until - Date.now()) / 1000));
    cooldownTimer = setInterval(() => {
      cooldownRemaining = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      if (cooldownRemaining <= 0) {
        clearInterval(cooldownTimer!);
        cooldownTimer = null;
        if (browser) localStorage.removeItem(COOLDOWN_KEY);
      }
    }, 1000);
  }

  $: if ($message === 'OK') {
    successToast('Profile updated & Discord synced!');
  } else if ($message === 'OK_DISCORD_FAIL') {
    successToast('Profile updated!');
  }
</script>

{#if data.user && data.user.surveyId !== null}
  <div class="max-w-2xl mx-auto px-4 py-6 space-y-4">

    <!-- Profile header -->
    <div class="card p-6 flex items-center gap-4">
      <ProfilePic hash={data.user.id} url={$form.profilePictureUrl} />
      <div>
        <h2 class="h2">
          {data.user.firstName}{data.user.lastName ? ` ${data.user.lastName}` : ''}
        </h2>
        <p class="text-sm opacity-60">{data.user.email}</p>
      </div>
    </div>

    <!-- Edit profile form -->
    <div class="card p-6 space-y-4">
      <h3 class="h3">Personal Info</h3>
      <form method="post" action="?/updateProfile" use:enhance class="space-y-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label class="label">
            <span>First Name</span>
            <input
              class="input"
              type="text"
              name="firstName"
              id="firstName"
              {...$constraints}
              autocomplete="given-name"
              bind:value={$form.firstName}
            />
            {#if $errors.firstName}
              <span class="badge variant-filled-error">{$errors.firstName}</span>
            {/if}
          </label>
          <label class="label">
            <span>Last Name</span>
            <input
              class="input"
              type="text"
              name="lastName"
              id="lastName"
              {...$constraints}
              autocomplete="family-name"
              bind:value={$form.lastName}
            />
            {#if $errors.lastName}
              <span class="badge variant-filled-error">{$errors.lastName}</span>
            {/if}
          </label>
        </div>

        <label class="label">
          <span>Discord Username <DiscordUsernameInfo /></span>
          <input
            class="input"
            type="text"
            name="discordProfileName"
            id="discordProfileName"
            bind:value={$form.discordProfileName}
            {...$constraints}
          />
          {#if $errors.discordProfileName}
            <span class="badge variant-filled-error">{$errors.discordProfileName}</span>
          {/if}
        </label>

        <label class="label">
          <span>Email</span>
          <input
            class="input"
            type="text"
            name="email"
            id="email"
            bind:value={$form.email}
            {...$constraints}
            autocomplete="email"
          />
          {#if $errors.email}
            <span class="badge variant-filled-error">{$errors.email}</span>
          {/if}
        </label>

        <label class="label">
          <span>Profile Picture URL <span class="opacity-50 text-xs">(optional)</span></span>
          <input
            class="input"
            type="url"
            name="profilePictureUrl"
            id="profilePictureUrl"
            placeholder="https://example.com/photo.jpg"
            bind:value={$form.profilePictureUrl}
          />
          {#if $errors.profilePictureUrl}
            <span class="badge variant-filled-error">{$errors.profilePictureUrl}</span>
          {/if}
        </label>

        {#if $message === 'OK_DISCORD_FAIL'}
          <p class="text-warning-500 text-sm">
            Profile saved, but your Discord username was not found in the server. Make sure
            it is spelled correctly and that you have joined the RCCF Discord.
          </p>
        {/if}

        <button
          type="submit"
          class="btn variant-ghost-secondary"
          disabled={cooldownRemaining > 0}
        >
          {cooldownRemaining > 0 ? `Update Profile (${cooldownRemaining}s)` : 'Update Profile'}
        </button>
      </form>
    </div>

    <!-- Member survey -->
    <div class="card p-6 flex items-center justify-between gap-4">
      <div>
        <h3 class="h3">Member Survey</h3>
        <p class="text-sm opacity-60 mt-1">Updated annually — required for active membership.</p>
      </div>
      <a href="/dashboard/profile/update survey" class="btn variant-ghost-secondary shrink-0">
        Update Survey
      </a>
    </div>

    <!-- Settings -->
    <div class="card p-6 space-y-4">
      <h3 class="h3">Settings</h3>
      <div class="flex items-center justify-between">
        <span class="text-sm">Color Theme</span>
        <LightSwitch />
      </div>
      <hr class="opacity-20" />
      <SignoutButton />
    </div>

    <!-- Danger Zone -->
    <div class="card p-6 space-y-4 border border-error-500">
      <h3 class="h3 text-error-500">Danger Zone</h3>
      <p class="text-sm opacity-70">
        Permanently deletes your account and all associated data. This cannot be undone.
      </p>
      <form method="post" action="?/deleteAccount" class="space-y-3">
        <label class="label">
          <span class="text-sm">Enter your full name: <strong>{fullName}</strong></span>
          <input
            class="input"
            type="text"
            name="confirmName1"
            placeholder="Full name"
            bind:value={deleteConfirm1}
            autocomplete="off"
          />
        </label>
        <label class="label">
          <span class="text-sm">Confirm your full name again</span>
          <input
            class="input"
            type="text"
            name="confirmName2"
            placeholder="Full name"
            bind:value={deleteConfirm2}
            autocomplete="off"
          />
        </label>
        {#if data.deleteError}
          <p class="text-error-500 text-sm">{data.deleteError}</p>
        {/if}
        <button
          type="submit"
          class="btn variant-filled-error"
          disabled={!deleteReady}
        >
          Delete My Account
        </button>
      </form>
    </div>

  </div>

{:else}
  <div class="max-w-2xl mx-auto px-4 py-6 space-y-4">
    <div class="card p-6">
      <h2 class="h2">No member survey on file</h2>
      <p class="mt-2 opacity-60 text-sm">
        The member survey is required before joining RCCF. It takes 1–3 minutes and can be updated later from this page.
      </p>
      <div class="mt-4">
        <a href="/dashboard/survey" class="btn variant-ghost-tertiary hover:variant-filled-tertiary">
          Create Member Survey
        </a>
      </div>
    </div>

    <!-- Settings still accessible even without a survey -->
    <div class="card p-6 space-y-4">
      <h3 class="h3">Settings</h3>
      <div class="flex items-center justify-between">
        <span class="text-sm">Color Theme</span>
        <LightSwitch />
      </div>
      <hr class="opacity-20" />
      <SignoutButton />
    </div>
  </div>
{/if}
