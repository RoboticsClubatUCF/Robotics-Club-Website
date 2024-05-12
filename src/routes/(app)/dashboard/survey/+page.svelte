<script lang="ts">
  import { superForm } from "sveltekit-superforms/client";
  import type { PageServerData } from "./$types";
  import { modeCurrent } from '@skeletonlabs/skeleton';

    export let data: PageServerData

    const{form, enhance, errors, constraints} = superForm(data.form);
</script>

<div class="h-screen grid place-items-center absolute w-screen top-0 pointer-events-none overflow-auto" style="margin-top: 90px; padding-bottom: 110px;">
  <div
    class={$modeCurrent
      ? 'block card p-8 pointer-events-auto shadow-xl shadow-surface-300'
      : 'block card p-8 pointer-events-auto shadow-xl shadow-surface-500'}
  >
    <form method="POST" class="p-2 rounded-md" use:enhance>
      <h2 class="h2">Members Survey</h2>
      <br />

      <label class="label">
        <span>GitHub Username (Optional)</span>
        <input
          class="input"
          type="text"
          name="gitName"
          id="gitName"
          bind:value={$form.gitName}
        />
        <!-- {#if $errors.gitName}
          <span class="variant-filled-error badge">{$errors.gitName}</span>
        {/if} -->
      </label>
      <br />

      <label class="label">
        <span>UCF Email</span> {#if $errors.ucfEmail}<span class="variant-filled-error badge">{$errors.ucfEmail}</span>{/if}
        <input
          class="input"
          type="email"
          name="ucfEmail"
          id="ucfEmail"
          bind:value={$form.ucfEmail}
          {...$constraints}
          required
          autocomplete="email"
        />
      </label>
      <br />

      <label class="label">
        <span>Major</span> {#if $errors.Major}<span class="variant-filled-error badge">{$errors.Major}</span>{/if}
          <div class="space-y-2">
            <label class="flex items-center space-x-2">
                <input class="checkbox" type="checkbox" name="Major" id="Major" bind:group={$form.Major} value="Aerospace Engineering "/>
                <p>Aerospace Engineering</p>
            </label>
            <label class="flex items-center space-x-2">
                <input class="checkbox" type="checkbox" name="Major" id="Major" bind:group={$form.Major} value="Computer Science "/>
                <p>Computer Science</p>
            </label>
            <label class="flex items-center space-x-2">
                <input class="checkbox" type="checkbox" name="Major" id="Major" bind:group={$form.Major} value="Computer Engineering "/>
                <p>Computer Engineering</p>
            </label>
            <label class="flex items-center space-x-2">
                <input class="checkbox" type="checkbox" name="Major" id="Major" bind:group={$form.Major} value="Electrical Engineering "/>
                <p>Electrical Engineering</p>
            </label>
            <label class="flex items-center space-x-2">
                <input class="checkbox" type="checkbox" name="Major" id="Major" bind:group={$form.Major} value="Mechanical Engineering "/>
                <p>Mechanical Engineering</p>
            </label>
            <label class="flex items-center space-x-2">
                <input class="checkbox" type="checkbox" name="Major" id="Major" bind:group={$form.Major} value="Not Listed "/>
                <p>Not Listed</p>
            </label>
            <label class="flex items-center space-x-2">
                <input class="checkbox" type="checkbox" name="Major" id="Major"  bind:group={$form.Major} value="Undecided "/>
                <p>Undecided</p>
            </label>
          </div>
      </label>
      <br />

      <label class="label">
        <span>Year</span> {#if $errors.year}<span class="variant-filled-error badge">{$errors.year}</span>{/if}
          <div class="space-y-2">
            <label class="flex items-center space-x-2">
              <input class="radio" type="radio" name="year" id="Freshman" bind:group={$form.year} value="Freshman"/>
              <p>Freshman</p>
            </label>
            <label class="flex items-center space-x-2">
              <input class="radio" type="radio" name="year" id="Sophomore" bind:group={$form.year} value="Sophomore" />
              <p>Sophomore</p>
            </label>
            <label class="flex items-center space-x-2">
              <input class="radio" type="radio" name="year" id="Junior" bind:group={$form.year} value="Junior" />
              <p>Junior</p>
            </label>
            <label class="flex items-center space-x-2">
              <input class="radio" type="radio" name="year" id="Senior" bind:group={$form.year} value="Senior" />
              <p>Senior</p>
            </label>
            <label class="flex items-center space-x-2">
              <input class="radio" type="radio" name="year" id="Graduate" bind:group={$form.year} value="Graduate" />
              <p>Graduate</p>
            </label>
            <label class="flex items-center space-x-2">
              <input class="radio" type="radio" name="year" id="Help" bind:group={$form.year} value="Send help I'm in school forever" />
              <p>Send help I'm in school forever</p>
            </label>
          </div>
      </label>
      <br />

      <label class="label">
        <span>Shirt Size</span> {#if $errors.shirtSize}<span class="variant-filled-error badge">{$errors.shirtSize}</span>{/if}
          <div class="space-y-2">
            <label class="flex items-center space-x-2">
              <input class="radio" type="radio" name="shirtSize" id="XS" bind:group={$form.shirtSize} value="XS" />
              <p>XS</p>
            </label>
            <label class="flex items-center space-x-2">
              <input class="radio" type="radio" name="shirtSize" id="S" bind:group={$form.shirtSize} value="S" />
              <p>S</p>
            </label>
            <label class="flex items-center space-x-2">
              <input class="radio" type="radio" name="shirtSize" id="M" bind:group={$form.shirtSize} value="M" />
              <p>M</p>
            </label>
            <label class="flex items-center space-x-2">
              <input class="radio" type="radio" name="shirtSize" id="L" bind:group={$form.shirtSize} value="L" />
              <p>L</p>
            </label>
            <label class="flex items-center space-x-2">
              <input class="radio" type="radio" name="shirtSize" id="XL" bind:group={$form.shirtSize} value="XL" />
              <p>XL</p>
            </label>
            <label class="flex items-center space-x-2">
              <input class="radio" type="radio" name="shirtSize" id="XXL" bind:group={$form.shirtSize} value="XXL" />
              <p>XXL</p>
            </label>
          </div>
      </label>
      <br />
      
      <label class="label">
        <span>Previous Member?</span> {#if $errors.prevMem}<span class="variant-filled-error badge">{$errors.prevMem}</span>{/if}
          <div class="space-y-2">
            <label class="flex items-center space-x-2">
              <input class="radio" type="radio" name="prevMem" id="prevMem" bind:group={$form.prevMem} value="Yes" />
              <p>Yes</p>
            </label>
            <label class="flex items-center space-x-2">
              <input class="radio" type="radio" name="prevMem" id="prevMem" bind:group={$form.prevMem} value="No" />
              <p>No</p>
            </label>
          </div>
      </label>
      <br />
      
      <label class="label">
        <span>Allergies</span> {#if $errors.allergies}<span class="variant-filled-error badge">{$errors.allergies}</span>{/if}
          <div class="space-y-2">
            <label class="flex items-center space-x-2">
              <input class="checkbox" type="checkbox" name="allergies" id="allergies" bind:group={$form.allergies} value="option 1 "/>
              <p>Option 1</p>
            </label>
            <label class="flex items-center space-x-2">
              <input class="checkbox" type="checkbox" name="allergies" id="allergies" bind:group={$form.allergies} value="option 2 "/>
              <p>Option 2</p>
            </label>
            <label class="flex items-center space-x-2">
              <input class="checkbox" type="checkbox" name="allergies" id="allergies" bind:group={$form.allergies} value="option 3 "/>
              <p>Option 3</p>
            </label>
          </div>
      </label>
      <br />
      
      <label class="label">
        <span>Disabilities</span> {#if $errors.disabilities}<span class="variant-filled-error badge">{$errors.disabilities}</span>{/if}
          <div class="space-y-2">
            <label class="flex items-center space-x-2">
              <input class="checkbox" type="checkbox" name="disabilities" id="disabilities" bind:group={$form.disabilities} value="option 1 "/>
              <p>Option 1</p>
            </label>
            <label class="flex items-center space-x-2">
              <input class="checkbox" type="checkbox" name="disabilities" id="disabilities" bind:group={$form.disabilities} value="option 2 "/>
              <p>Option 2</p>
            </label>
            <label class="flex items-center space-x-2">
              <input class="checkbox" type="checkbox" name="disabilities" id="disabilities" bind:group={$form.disabilities} value="option 3 "/>
              <p>Option 3</p>
            </label>
          </div>
      </label>
      <br />

      <button class="btn variant-ghost-primary mt-4 hover:variant-filled-primary">Submit Form</button>
    </form>
  </div>
</div>
