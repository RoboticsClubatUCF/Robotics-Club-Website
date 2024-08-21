<script lang="ts">
    import { superForm } from "sveltekit-superforms/client";
    import { InputChip, modeCurrent } from '@skeletonlabs/skeleton';
    import type { PageData } from './$types';
    import { onMount } from "svelte";
    import { injectDots } from "../../../../components/pixijs/dotsAnimation";
    import { Autocomplete, popup } from '@skeletonlabs/skeleton';
    import type { AutocompleteOption, PopupSettings } from '@skeletonlabs/skeleton';
  
    export let data: PageData;
    const { form, errors, constraints, enhance, message } = superForm(data.form, {
      clearOnSubmit: 'errors-and-message'
    });
  
    let mainEle: HTMLElement;
  
    onMount(() => {
      injectDots(mainEle, 200);
    });

  let notClicked: boolean = true;
  let input: string = '';    
  let projectId: number | null = null;
  let popupSettings: PopupSettings = {
    event: 'focus-click',
    target: 'popupAutocomplete',
    placement: 'bottom',
  };
  const projectOptions: AutocompleteOption[] = data.member.Projects.map (project => ({
    label: `${project.title}`,
    value: project.id,
    keywords: `${project.title}, ${project.season}, ${project.year}`,
    meta: {}
  }));
  
  function onProjectSelection(event: CustomEvent<AutocompleteOption>): void {
    input = event.detail.label;
    projectId = event.detail.value as number | null;
  };
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
    <h2 class="h2">Edit a Project</h2><input
    class="hidden"
    type="number"
    name="projectId"
    id="projectId"
    bind:value={$form.id}
  />
      {#if !data.currentProject}
        <form action="?/selectProject" method="POST" class="p-2 rounded-md" use:enhance>
          <p>Select a Project</p>
            <input
            class="input autocomplete"
            type="search"
            name="autocomplete-search"
            bind:value={input}
            placeholder="Search..."
            use:popup={popupSettings}
            />

            <div class="card p-4 w-72 shadow-xl scroll_div" data-popup="popupAutocomplete">
            <Autocomplete
              bind:input={input}
              options={projectOptions}
              on:selection={onProjectSelection}
            />
            </div>
            <input type="hidden" name="projectId" value={projectId} />
            <button type="submit" class="btn variant-ghost-tertiary hover:variant-filled-tertiary mt-2">Edit</button>
        </form>
      {/if}
      {#if data.currentProject}
      <form action="?/updateProject" method="POST" class="p-2 rounded-md" use:enhance>
        <label class="label">
            <span>Project Title</span> {#if $errors.title}<span class="variant-filled-error badge">{$errors.title}</span>{/if}
            <input
              class="input"
              type="text"
              name="title"
              id="title"
              placeholder="Enter Title"
              bind:value={$form.title}
            />
        </label>
        
        <br />
        <label class="label">
            <span>Description (Optional)</span>
            <textarea
              class="textarea"
              name="description"
              id="description"
              bind:value={$form.description}
              placeholder="Enter a Description"
              rows="4"
              style="min-height: 6em;"
            ></textarea>
        </label>

        <br />
        <label class="label">
            <span>Picture</span> {#if $errors.logo}<span class="variant-filled-error badge">{$errors.logo}</span>{/if}
            <input
              class="input"
              type="url"
              name="logo"
              id="logo"
              placeholder="Enter Image Address"
              bind:value={$form.logo}
            />
        </label>

        <br />
        <label class="label">
            <span>Documentation</span> {#if $errors.docsLink}<span class="variant-filled-error badge">{$errors.docsLink}</span>{/if}
            <input
              class="input"
              type="url"
              name="docsLink"
              id="docsLink"
              placeholder="Enter link to project documentation"
              bind:value={$form.docsLink}
            />
        </label>

        <br />
        <label class="label">
            <span>Season</span> {#if $errors.season}<span class="variant-filled-error badge">{$errors.season}</span>{/if}
              <div class="space-y-2">
                <label class="flex items-center space-x-2">
                  <input class="radio" type="radio" name="season" id="Fall" bind:group={$form.season} value="Fall" />
                  <p>Fall</p>
                </label>
                <label class="flex items-center space-x-2">
                  <input class="radio" type="radio" name="season" id="Spring" bind:group={$form.season} value="Spring" />
                  <p>Spring</p>
                </label>
                <label class="flex items-center space-x-2">
                  <input class="radio" type="radio" name="season" id="Summer" bind:group={$form.season} value="Summer" />
                  <p>Summer</p>
                </label>
              </div>
        </label>

        <br />
        <label class="label">
            <span>Year</span>{#if $errors.year}<span class="variant-filled-error badge">{$errors.year}</span>{/if}
            <label class="flex items-center space-x-2">
                <input class="input" type="text" name="year" id="year" bind:value={$form.year} placeholder="Enter Year"/>
            </label>
        </label>

        <br />
        <!-- svelte-ignore a11y-label-has-associated-control -->
        <label class="label">
            <span>Skills (Optional)</span>{#if $errors.Skills}<span class="variant-filled-error badge">{$errors.Skills}</span>{/if}
            <!-- svelte-ignore a11y-label-has-associated-control -->
            <label class="flex items-center space-x-2">
                <InputChip name="chips" type="text" placeholder="Enter Any Wanted Skills" bind:value={$form.Skills} />
            </label>
        </label>
        <button class="btn variant-ghost-primary mt-4 hover:variant-filled-primary">Finish</button>
      </form>
      {/if}
    </div>
  </div>
  