<script lang="ts">
  import { superForm } from "sveltekit-superforms/client";
  import type { PageServerData } from "./$types";
  import { modeCurrent } from '@skeletonlabs/skeleton';

    export let data: PageServerData

    const{form, enhance, errors, constraints} = superForm(data.form);
</script>

<div class="h-screen grid place-items-center absolute w-screen top-0 pointer-events-none overflow-auto">
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
          autocomplete="email"
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
            <input
            class="input"
            type="hidden"
            name="Major"
            id="Major"
            bind:value={$form.Major}
            {...$constraints}
            required
          />
        </div>      
        </label>
        {#if $errors.Major}
            <span class="variant-filled-error badge">{$errors.Major}</span>
        {/if}

        <br />
        <label class="label">
          <span>Year (Best Fit)*</span>
          <div class="space-y-2">
            <select class="select">
              <option value="Freshman">Freshman</option>
              <option value="Sophomore">Sophomore</option>
              <option value="Junior">Junior</option>
              <option value="Senior">Senior</option>
              <option value="Graduate">Graduate</option>
              <option value="Send help I'm in school forever">Send help I'm in school forever</option>
            </select>
            <input
            class="input"
            type="hidden"
            name="year"
            id="year"
            bind:value={$form.Major}
            {...$constraints}
            required
          />
          </div>      
          </label>
          {#if $errors.year}
              <span class="variant-filled-error badge">{$errors.year}</span>
          {/if}

          <br />
          <label class="label">
            <span>Shirt Size*</span>
            <div class="space-y-2">
              <label class="flex items-center space-x-2">
                <input class="radio" type="radio" name="radio-direct" value="XS" />
                <p>XS</p>
              </label>
              <label class="flex items-center space-x-2">
                <input class="radio" type="radio" name="radio-direct" value="S" />
                <p>S</p>
              </label>
              <label class="flex items-center space-x-2">
                <input class="radio" type="radio" name="radio-direct" value="M" />
                <p>M</p>
              </label>
              <label class="flex items-center space-x-2">
                <input class="radio" type="radio" name="radio-direct" value="L" />
                <p>L</p>
              </label>
              <label class="flex items-center space-x-2">
                <input class="radio" type="radio" name="radio-direct" value="XL" />
                <p>XL</p>
              </label>
              <label class="flex items-center space-x-2">
                <input class="radio" type="radio" name="radio-direct" value="XXL" />
                <p>XXL</p>
              </label>
            </div>
            </label>
            {#if $errors.shirtSize}
            <span class="variant-filled-error badge">{$errors.shirtSize}</span>
            {/if}

            <br />
            <label class="label">
              <span>Previous Member?*</span>
                <div class="space-y-2">
                  <label class="flex items-center space-x-2">
                    <input class="radio" type="radio" name="radio-direct" value=true />
                    <p>Yes</p>
                  </label>
                  <label class="flex items-center space-x-2">
                    <input class="radio" type="radio" name="radio-direct" value=false />
                    <p>No</p>
                  </label>
                </div>
            </label>
            {#if $errors.prevMem}
            <span class="variant-filled-error badge">{$errors.prevMem}</span>
            {/if}

            <br />
            <label class="label">
              <span>Allergies*</span>
                <div class="space-y-2">
                  <label class="flex items-center space-x-2">
                    <input class="checkbox" type="checkbox" />
                    <p>Option 1</p>
                  </label>
                  <label class="flex items-center space-x-2">
                    <input class="checkbox" type="checkbox" />
                    <p>Option 2</p>
                  </label>
                  <label class="flex items-center space-x-2">
                    <input class="checkbox" type="checkbox" />
                    <p>Option 3</p>
                  </label>
                </div>
            </label>
            {#if $errors.allergies}
            <span class="variant-filled-error badge">{$errors.allergies}</span>
            {/if}

            <br />
            <label class="label">
              <span>Disabilities*</span>
                <div class="space-y-2">
                  <label class="flex items-center space-x-2">
                    <input class="checkbox" type="checkbox" />
                    <p>Option 1</p>
                  </label>
                  <label class="flex items-center space-x-2">
                    <input class="checkbox" type="checkbox" />
                    <p>Option 2</p>
                  </label>
                  <label class="flex items-center space-x-2">
                    <input class="checkbox" type="checkbox" />
                    <p>Option 3</p>
                  </label>
                </div>
            </label>
      <button class="btn variant-ghost-primary mt-4 hover:variant-filled-primary">Submit Form</button>
    </form>
  </div>
</div>
