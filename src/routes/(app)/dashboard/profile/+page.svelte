<script lang="ts">
  import {
    AppBar,
    AppShell,
    type DrawerSettings,
    getDrawerStore,
    modeCurrent
  } from '@skeletonlabs/skeleton';
  import { superForm } from 'sveltekit-superforms/client';
  import type { PageData } from './$types';
  import successToast from '../../../../components/toasts/successToast';
  import ProfilePicPreview from '../../../../components/dashboard/profilePicPreview.svelte';

  export let data: PageData;
  const { form, constraints, enhance, errors, message } = superForm(data.form);
  $: if ($message == 'OK') {
    successToast('Profile Updated!');
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
          <span>Discord Username</span>
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
        <div class="grid grid-cols-2 m-4">
          <!-- <ProfilePicPreview hash={data.user.id} /> -->
          <div class="flex">
            <div>
              <button type="submit" class="btn variant-ghost-secondary btn-xl">Update Profile</button>
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
      <!-- Content for users who haven't completed the survey -->
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