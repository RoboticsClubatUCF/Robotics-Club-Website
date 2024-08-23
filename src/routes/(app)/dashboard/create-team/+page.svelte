<script lang="ts">
  import { superForm } from "sveltekit-superforms/client";
  import { InputChip, modeCurrent } from '@skeletonlabs/skeleton';
  import type { PageServerData } from './$types';
  import { onMount } from "svelte";
  import { injectDots } from "../../../../components/pixijs/dotsAnimation";
  import { Autocomplete, popup } from '@skeletonlabs/skeleton';
  import type { AutocompleteOption, PopupSettings } from '@skeletonlabs/skeleton';

  export let data: PageServerData;
  const { form, errors, constraints, enhance, message } = superForm(data.form, {
    clearOnSubmit: 'errors-and-message'
  });

  let mainEle: HTMLElement;

  onMount(() => {
    injectDots(mainEle, 200);
  });

  let input: string = '';
  let projectId: number | unknown;
  let popupSettingsProject: PopupSettings = {
    event: 'focus-click',
    target: 'popupAutocompleteProject',
    placement: 'bottom',
  };

  const projectOptions: AutocompleteOption[] = data.projects.map(project => ({
    label: `${project.title} ${project.season} ${project.year}`,
    value: project.id,
    keywords: `${project.title}, ${project.season}, ${project.year}, ${project.title} ${project.season} ${project.year}`,
    meta: {}
  }));

  function onProjectSelection(event: CustomEvent<AutocompleteOption>): void {
    input = event.detail.label;
    projectId = event.detail.value;
  }

  let teamLead: string = '';
  let leadId: number | unknown;
  let popupSettingsLead: PopupSettings = {
    event: 'focus-click',
    target: 'popupAutocompleteLead',
    placement: 'bottom',
  };

  const memberOptions: AutocompleteOption[] = data.members.map(member => ({
    label: `${member.firstName} ${member.lastName}`,
    value: member.id,
    keywords: `${member.firstName} ${member.lastName}, ${member.discordProfileName}`,
    meta: {}
  }));

  function onLeadSelection(event: CustomEvent<AutocompleteOption>): void {
    teamLead = event.detail.label;  // Update input field with selected admin's name
    leadId = event.detail.value as string | null;  // Store selected admin ID
    // console.log(selectedAdminId);
  }

</script>

<style>
  .scroll_div{
    overflow: auto;
    max-height: 100px;
  }
</style>
  
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
        <h2 class="h2">Create a Team</h2>
        
        <br />
        <label class="label">
            <span>Team Name</span> {#if $errors.name}<span class="variant-filled-error badge">{$errors.name}</span>{/if}
            <input
              class="input"
              type="text"
              name="name"
              id="name"
              placeholder="Enter Team Name"
              bind:value={$form.name}
            />
        </label>

        <br />
        <label class="label">
            <span>Team Lead</span> {#if $errors.teamLead}<span class="variant-filled-error badge">{$errors.teamLead}</span>{/if}
            <input
            class="input autocomplete"
            type="search"
            name="autocomplete-search-lead"
            bind:value={teamLead}
            placeholder="Search..."
            use:popup={popupSettingsLead}
            />
            <div class="card p-4 w-72 shadow-xl scroll_div" data-popup="popupAutocompleteLead">
            <Autocomplete
              bind:input={teamLead}
              options={memberOptions}
              on:selection={onLeadSelection}
            />
            </div>
        </label>

        <br />
        <label class="label">
            <span>For Project</span> {#if $errors.projectId}<span class="variant-filled-error badge">{$errors.projectId}</span>{/if}
            <input
            class="input autocomplete"
            type="search"
            name="autocomplete-search-project"
            bind:value={input}
            placeholder="Search..."
            use:popup={popupSettingsProject}
            />
            <div class="card p-4 w-72 shadow-xl scroll_div" data-popup="popupAutocompleteProject">
            <Autocomplete
              bind:input={input}
              options={projectOptions}
              on:selection={onProjectSelection}
            />
            </div>
        </label>
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="teamLead" value={leadId} />
        <button class="btn variant-ghost-primary mt-4 hover:variant-filled-primary">Create</button>
      </form>
    </div>
  </div>
  