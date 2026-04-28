<script lang="ts">
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import { modeCurrent } from '@skeletonlabs/skeleton';
  import { superForm } from 'sveltekit-superforms';
  import type { PageData } from './$types';
  import successToast from '../../../../components/toasts/successToast';
  import DiscordUsernameInfo from '../../../../components/DiscordUsernameInfo.svelte';

  export let data: PageData;
  const { form, constraints, enhance, errors, message } = superForm(data.form, {
    resetForm: false,
    onSubmit: () => {
      startCooldown();
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
  <div class="container w-full m-auto mt-10">
    <div class="card m-2 p-2">
      <h2 class="h2 card-header">Edit profile</h2>
      <form method="post" use:enhance>
        <div class="grid grid-cols-2">
          <label class="label m-2 p-2">
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
          <label class="label m-2 p-2">
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
        <label class="label m-2 p-2">
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
        <label class="label m-2 p-2">
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

        {#if $message === 'OK_DISCORD_FAIL'}
          <p class="text-warning-500 text-sm m-2 px-2">
            Profile saved, but your Discord username was not found in the server. Make sure
            it is spelled correctly and that you have joined the RCCF Discord.
          </p>
        {/if}

        <div class="grid grid-cols-2 m-4">
          <div class="flex">
            <div>
              <button
                type="submit"
                class="btn variant-ghost-secondary btn-xl"
                disabled={cooldownRemaining > 0}
              >
                {#if cooldownRemaining > 0}
                  Update Profile ({cooldownRemaining}s)
                {:else}
                  Update Profile
                {/if}
              </button>
              <br/>
              <br/>
              <a
                id="survey"
                href="/dashboard/profile/update survey"
                class="btn variant-ghost-secondary btn-xl">Members Survey
              </a>
            </div>
          </div>
        </div>
      </form>
    </div>
  </div>
  {:else}
  <div class="m-4">
    <div
      class={$modeCurrent
        ? 'block card p-8 pointer-events-auto shadow-m shadow-surface-300 justify-center'
        : 'block card p-8 pointer-events-auto shadow-m shadow-surface-500 justify-center'}
    >
      <div class="p-2 rounded-md">
        <h2 class="h2">Oops looks like you haven't filled out a members survey yet...</h2>
        <span> </span>
        <br/>

        <h3 class="h3">The members survey is a requirement for anyone trying to become a member of RCCF!
          It's a quick 1-3 minute survey on some general and important information about you as a possible member!
          You can create one with the button below and if you need to change it later you can update your survey in your profile by clicking on the avatar in the top right corner!
        </h3>
        <br/>
        <a
          id="survey"
          href="/dashboard/survey"
          class="btn variant-ghost-tertiary hover:variant-filled-tertiary">Create a Members Survey
        </a>
      </div>
    </div>
  </div>
{/if}
