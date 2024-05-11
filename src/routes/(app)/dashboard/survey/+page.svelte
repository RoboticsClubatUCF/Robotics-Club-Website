<script lang="ts">
  import { superForm } from "sveltekit-superforms/client";
  import type { PageServerData } from "./$types";
  import { modeCurrent } from '@skeletonlabs/skeleton';

    export let data: PageServerData

    const{form, enhance, errors, constraints} = superForm(data.form);
</script>

<div class="h-screen grid place-items-center absolute w-screen top-0 pointer-events-none">
  <div
    class={$modeCurrent
      ? 'block card p-8 pointer-events-auto shadow-xl shadow-surface-300'
      : 'block card p-8 pointer-events-auto shadow-xl shadow-surface-500'}
  >
    <form method="POST" class="p-2 rounded-md" use:enhance>
      <h2 class="h2">Welcome to the members Survey!</h2>
      
      <br />
      <label class="label">
        <span>GitHub Username (optional)</span>
        <input
          class="input"
          type="text"
          name="gitName"
          id="gitName"
          bind:value={$form.gitName}
          {...$constraints}
          required
        />
        {#if $errors.gitName}
          <span class="variant-filled-error badge">{$errors.gitName}</span>
        {/if}
      </label>
      <br />

      <label class="label">
        <span>UCF Email*</span>
        <input
          class="input"
          type="text"
          name="ucfEmail"
          id="ucfEmail"
          bind:value={$form.ucfEmail}
          {...$constraints}
          required
        />
        {#if $errors.ucfEmail}
          <span class="variant-filled-error badge">{$errors.ucfEmail}</span>
        {/if}
      </label>
      <br />

      <label class="label">
        <span>Major*</span>
        <div class="space-y-2">
            <label class="flex items-center space-x-2">
                <input class="checkbox" type="checkbox" bind:group={$form.Major} value="Aerospace Engineering" />
                <p>Aerospace Engineering</p>
            </label>
            <label class="flex items-center space-x-2">
                <input class="checkbox" type="checkbox" bind:group={$form.Major} value="Computer Science" />
                <p>Computer Science</p>
            </label>
            <label class="flex items-center space-x-2">
                <input class="checkbox" type="checkbox" bind:group={$form.Major} value="Computer Engineering" />
                <p>Computer Engineering</p>
            </label>
            <label class="flex items-center space-x-2">
                <input class="checkbox" type="checkbox" bind:group={$form.Major} value="Electrical Engineering" />
                <p>Electrical Engineering</p>
            </label>
            <label class="flex items-center space-x-2">
                <input class="checkbox" type="checkbox" bind:group={$form.Major} value="Mechanical Engineering" />
                <p>Mechanical Engineering</p>
            </label>
            <label class="flex items-center space-x-2">
                <input class="checkbox" type="checkbox" bind:group={$form.Major} value="Not Listed" />
                <p>Not Listed</p>
            </label>
            <label class="flex items-center space-x-2">
                <input class="checkbox" type="checkbox" bind:group={$form.Major} value="Undecided" />
                <p>Undecided</p>
            </label>
        </div>      
        </label>
        {#if $errors.Major}
            <span class="variant-filled-error badge">{$errors.Major}</span>
        {/if}
      <button class="btn variant-ghost-primary mt-4 hover:variant-filled-primary">Submit Form</button>
    </form>
  </div>
</div>
