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
  import successToast from '../../../../../components/toasts/successToast';

  export let data: PageData;
  const { form, constraints, enhance, errors, message } = superForm(data.form);
  $: if ($message == 'OK') {
    successToast('Survey Updated!');
  }
</script>

<div class="container w-full m-auto mt-10">
  <div class="card m-2 p-2">
    <form method="post" class="p-2 rounded-md" use:enhance>
      <h2 class="h2">Updating Members Survey</h2>
      <br />

      <label class="label">
        <span>GitHub Username (Optional)</span> {#if $errors.gitName}<span class="variant-filled-error badge">{$errors.gitName}</span>{/if}
        <input
          class="input"
          type="text"
          name="gitName"
          id="gitName"
          placeholder="User"
          bind:value={$form.gitName}
        />
      </label>
      <br />

      <label class="label">
        <span>UCF Email</span> {#if $errors.ucfEmail}<span class="variant-filled-error badge">{$errors.ucfEmail}</span>{/if}
        <input
          class="input"
          type="email"
          name="ucfEmail"
          id="ucfEmail"
          placeholder="NID@ucf.edu"
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
                <input class="checkbox" type="checkbox" name="Major" id="AerospaceEngineering" bind:group={$form.Major} value="Aerospace Engineering "/>
                <p>Aerospace Engineering</p>
            </label>
            <label class="flex items-center space-x-2">
                <input class="checkbox" type="checkbox" name="Major" id="ComputerScience" bind:group={$form.Major} value="Computer Science "/>
                <p>Computer Science</p>
            </label>
            <label class="flex items-center space-x-2">
                <input class="checkbox" type="checkbox" name="Major" id="ComputerEngineering" bind:group={$form.Major} value="Computer Engineering "/>
                <p>Computer Engineering</p>
            </label>
            <label class="flex items-center space-x-2">
                <input class="checkbox" type="checkbox" name="Major" id="ElectricalEngineering" bind:group={$form.Major} value="Electrical Engineering "/>
                <p>Electrical Engineering</p>
            </label>
            <label class="flex items-center space-x-2">
                <input class="checkbox" type="checkbox" name="Major" id="MechanicalEngineering" bind:group={$form.Major} value="Mechanical Engineering "/>
                <p>Mechanical Engineering</p>
            </label>
            <label class="flex items-center space-x-2">
                <input class="checkbox" type="checkbox" name="Major" id="Undecided" bind:group={$form.Major} value="Undecided "/>
                <p>Undecided</p>
            </label>
            <label class="flex items-center space-x-2">
                <input class="checkbox" type="checkbox" name="Major" id="Other" bind:group={$form.Major} value="Other"/>
                <p>Other</p> {#if $errors.oMajor}<span class="variant-filled-error badge">{$errors.oMajor}</span>{/if}
            </label>
            {#if $form.Major.includes("Other")}
            <label class="flex items-center space-x-2">
                <input class="input" type="text" name="oMajor" id="oMajor" bind:value={$form.oMajor} placeholder="Enter your major "/>
            </label>
            {/if}
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
            {#if $form.prevMem.includes("Yes")}
            <label class="label">
              <span>Number of Semester(s) you have been in the club? </span>{#if $errors.semester}<span class="variant-filled-error badge">{$errors.semester}</span>{/if}
              <label class="flex items-center space-x-2">
                  <input class="input" type="text" name="semester" id="semester" bind:value={$form.semester} placeholder="Num >= 0"/>
              </label>
            </label>
            {/if}
          </div>
      </label>
      <br />
      
      <label class="label">
        <span>Allergies</span> {#if $errors.allergies}<span class="variant-filled-error badge">{$errors.allergies}</span>{/if}
          <div class="space-y-2">
            <label class="flex items-center space-x-2">
              <input class="checkbox" type="checkbox" name="allergies" id="allergies" bind:group={$form.allergies} value="Dairy "/>
              <p>Dairy</p>
            </label>
            <label class="flex items-center space-x-2">
              <input class="checkbox" type="checkbox" name="allergies" id="allergies" bind:group={$form.allergies} value="Eggs "/>
              <p>Eggs</p>
            </label>
            <label class="flex items-center space-x-2">
              <input class="checkbox" type="checkbox" name="allergies" id="allergies" bind:group={$form.allergies} value="Fish "/>
              <p>Fish</p>
            </label>
            <label class="flex items-center space-x-2">
              <input class="checkbox" type="checkbox" name="allergies" id="allergies" bind:group={$form.allergies} value="Nuts "/>
              <p>Nuts</p>
            </label>
            <label class="flex items-center space-x-2">
              <input class="checkbox" type="checkbox" name="allergies" id="allergies" bind:group={$form.allergies} value="Shellfish "/>
              <p>Shellfish</p>
            </label>
            <label class="flex items-center space-x-2">
              <input class="checkbox" type="checkbox" name="allergies" id="allergies" bind:group={$form.allergies} value="Sesame "/>
              <p>Sesame</p>
            </label>
            <label class="flex items-center space-x-2">
              <input class="checkbox" type="checkbox" name="allergies" id="allergies" bind:group={$form.allergies} value="Soy "/>
              <p>Soy</p>
            </label>
            <label class="flex items-center space-x-2">
              <input class="checkbox" type="checkbox" name="allergies" id="allergies" bind:group={$form.allergies} value="None"/>
              <p>None</p>
            </label>
            <label class="flex items-center space-x-2">
              <input class="checkbox" type="checkbox" name="allergies" id="allergies" bind:group={$form.allergies} value="Other"/>
              <p>Other</p> {#if $errors.oAllergies}<span class="variant-filled-error badge">{$errors.oAllergies}</span>{/if}
            </label>
            {#if $form.allergies.includes("Other")}
            <label class="flex items-center space-x-2">
                <input class="input" type="text" name="oAllergies" id="oAllergies" bind:value={$form.oAllergies} placeholder="Allergen1, Allergen2, Allergen3..."/>
            </label>
            {/if}
          </div>
      </label>
      <br />
      
      <label class="label">
        <span>Concerns (Optional)</span>
        <textarea
          class="textarea"
          name="otherConcerns"
          id="otherConcerns"
          bind:value={$form.otherConcerns}
          placeholder="Enter any concerns you may have about being a member."
          rows="4"
          style="min-height: 6em;"
        ></textarea>
      </label>
      <br />

      <button class="btn variant-ghost-primary mt-4 hover:variant-filled-primary">Update Form</button>
    </form>
  </div>
</div>