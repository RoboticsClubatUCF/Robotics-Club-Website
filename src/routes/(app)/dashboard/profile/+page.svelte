<script lang="ts">
  import { superForm } from 'sveltekit-superforms/client';
  import type { PageData } from './$types';
  import successToast from '../../../../components/toasts/successToast';

  export let data: PageData;
  const { form, constraints, enhance, errors, message } = superForm(data.form);
  $: if ($message == 'OK') {
    successToast('Profile Updated!');
  }
</script>

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
      <div class="flex flex-row-reverse">
        <button type="submit" class="btn variant-ghost-secondary btn-xl">Update Profile</button>
      </div>
    </form>
  </div>
</div>
