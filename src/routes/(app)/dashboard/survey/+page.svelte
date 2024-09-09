<script lang="ts">
  import { superForm } from "sveltekit-superforms/client";
  import { modeCurrent } from '@skeletonlabs/skeleton';
  import type { PageData } from './$types';
  import { onMount } from "svelte";
  import { injectDots } from "../../../../components/pixijs/dotsAnimation";
  import { getMonth } from 'date-fns';

  export let data: PageData;
  const { form, errors, constraints, enhance } = superForm(data.form, {
    clearOnSubmit: 'errors-and-message'
  });

  let mainEle: HTMLElement;
  let Display = "";

  onMount(() => {
    injectDots(mainEle, 200);
    const today = new Date();
    const month = getMonth(today) + 1;
    if (month >= 1 && month <= 4) {
      Display = "Spring";
    } else if (month >= 8 && month <= 12) {
      Display = "Fall";
    }
  });
</script>

<div
  bind:this={mainEle}
  class="absolute top-20 left-0 right-0 bottom-0 pointer-events-auto -z-20"
/>

<div class="h-screen grid place-items-center absolute w-screen top-0 pointer-events-none overflow-auto" style="margin-top: 90px; padding-bottom: 110px;">
  <div
    class={$modeCurrent
      ? 'block card p-8 pointer-events-auto shadow-xl shadow-surface-300'
      : 'block card p-8 pointer-events-auto shadow-xl shadow-surface-500'}
  >
    <form method="POST" class="p-2 rounded-md" use:enhance>
      <h2 class="h2">Creating Members Survey</h2>
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
              <span>Number of Semester(s) With RCCF? </span>{#if $errors.semester}<span class="variant-filled-error badge">{$errors.semester}</span>{/if}
              <label class="flex items-center space-x-2">
                  <input class="input" type="text" name="semester" id="semester" bind:value={$form.semester} placeholder="Num >= 0"/>
              </label>
            </label>
            {/if}
          </div>
      </label>
      <br />

      <label class="label">
        <span>How did you first discover us?</span> {#if $errors.discover}<span class="variant-filled-error badge">{$errors.discover}</span>{/if}
        <div class="space-y-2">
            <label class="flex items-center space-x-2">
                <input class="checkbox" type="checkbox" name="discover" id="Friend(s)" bind:group={$form.discover} value="Friend(s) "/>
                <p>Friend(s)</p>
            </label>
            <label class="flex items-center space-x-2">
                <input class="checkbox" type="checkbox" name="discover" id="Events" bind:group={$form.discover} value="Events "/>
                <p>Events</p>
            </label>
            <label class="flex items-center space-x-2">
                <input class="checkbox" type="checkbox" name="discover" id="Posters" bind:group={$form.discover} value="Posters "/>
                <p>Posters</p>
            </label>
            <label class="flex items-center space-x-2">
                <input class="checkbox" type="checkbox" name="discover" id="Social Media" bind:group={$form.discover} value="Social Media "/>
                <p>Social Media</p>
            </label>
            <label class="flex items-center space-x-2">
              <input class="checkbox" type="checkbox" name="discover" id="Knight Connect" bind:group={$form.discover} value="Knight Connect "/>
              <p>Knight Connect</p>
            </label>
            <label class="flex items-center space-x-2">
              <input class="checkbox" type="checkbox" name="discover" id="GANOR" bind:group={$form.discover} value="GANOR "/>
              <p>GNOR</p>
            </label>
            <label class="flex items-center space-x-2">
                <input class="checkbox" type="checkbox" name="discover" id="Google" bind:group={$form.discover} value="Google "/>
                <p>Google</p>
            </label>
            {#if Display == "Fall"}
            <label class="flex items-center space-x-2">
                  <input class="checkbox" type="checkbox" name="discover" id="Class Presentations" bind:group={$form.discover} value="Class Presentations Fall"/>
                  <p>Class Presentations</p>
              </label>
            {/if}
            {#if Display == "Spring"}
            <label class="flex items-center space-x-2">
                  <input class="checkbox" type="checkbox" name="discover" id="Class Presentations" bind:group={$form.discover} value="Class Presentations Spring"/>
                  <p>Class Presentations</p>
              </label>
            {/if}

            {#if $form.discover.includes("Class Presentations Fall")}
            <label class="label">
              <span>Which Fall class?</span>
                <label class="flex items-center space-x-2">
                  <input class="checkbox" type="checkbox" name="discover" id="intro to engineering fall" bind:group={$form.discover} value="EGS 1006C "/>
                  <p>Intro to Engineering</p>
                </label>
                <label class="flex items-center space-x-2">
                  <input class="checkbox" type="checkbox" name="discover" id="intro to robotics fall" bind:group={$form.discover} value="EGN 3060C "/>
                  <p>Intro to Robotics</p>
                </label>
                <label class="flex items-center space-x-2">
                  <input class="checkbox" type="checkbox" name="discover" id="STEM Seminar I fall" bind:group={$form.discover} value="ISC 2054 "/>
                  <p>STEM Seminar I</p>
                </label>
                <label class="flex items-center space-x-2">
                  <input class="checkbox" type="checkbox" name="discover" id="STEM Seminar II fall" bind:group={$form.discover} value="ISC 2055 "/>
                  <p>STEM Seminar II</p>
                </label>
                <label class="flex items-center space-x-2">
                  <input class="checkbox" type="checkbox" name="discover" id="Unlisted fall" bind:group={$form.discover} value="Unlisted "/>
                  <p>Unlisted</p>
                </label>
            </label>
            {/if}

            {#if $form.discover.includes("Class Presentations Spring")}
            <label class="label">
              <span>Which Spring class?</span>
                <label class="flex items-center space-x-2">
                  <input class="checkbox" type="checkbox" name="discover" id="intro to engineering spring" bind:group={$form.discover} value="EGS 1006C "/>
                  <p>Intro to engineering</p>
                </label>
                <label class="flex items-center space-x-2">
                  <input class="checkbox" type="checkbox" name="discover" id="intro to robotics spring" bind:group={$form.discover} value="EGN 3060C "/>
                  <p>Intro to Robotics</p>
                </label>
                <label class="flex items-center space-x-2">
                  <input class="checkbox" type="checkbox" name="discover" id="STEM Seminar I spring" bind:group={$form.discover} value="ISC 2054 "/>
                  <p>STEM Seminar I</p>
                </label>
                <label class="flex items-center space-x-2">
                  <input class="checkbox" type="checkbox" name="discover" id="STEM Seminar II spring" bind:group={$form.discover} value="ISC 2055 "/>
                  <p>STEM Seminar II</p>
                </label>
                <label class="flex items-center space-x-2">
                  <input class="checkbox" type="checkbox" name="discover" id="Unlisted spring" bind:group={$form.discover} value="Unlisted "/>
                  <p>Unlisted</p>
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
      
      <button class="btn variant-ghost-primary mt-4 hover:variant-filled-primary">Submit Form</button>
    </form>
  </div>
</div>
