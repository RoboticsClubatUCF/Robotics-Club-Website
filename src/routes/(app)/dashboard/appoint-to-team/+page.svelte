<script lang="ts">
    import { superForm } from "sveltekit-superforms/client";
    import { InputChip, modeCurrent } from '@skeletonlabs/skeleton';
    import type { PageServerData } from './$types';
    import { onMount } from "svelte";
    import { injectDots } from "../../../../components/pixijs/dotsAnimation";
    import { Autocomplete, popup } from '@skeletonlabs/skeleton';
    import type { AutocompleteOption, PopupSettings } from '@skeletonlabs/skeleton';
    import { append } from "svelte/internal";
  
    export let data: PageServerData;
    const { form, errors, constraints, enhance, message } = superForm(data.form, {
      clearOnSubmit: 'errors-and-message'
    });
  
    let mainEle: HTMLElement;
  
    onMount(() => {
      injectDots(mainEle, 200);
    });

    let input: string = '';
    let memInput: string = '';
    let inputList: string[] = [];  // Initialize as an empty array
    let memIdList: string[] = [];  // Initialize as an empty array
    let teamId: string = '';
    let popupSettingsTeam: PopupSettings = {
        event: 'focus-click',
        target: 'popupAutocompleteTeam',
        placement: 'bottom',
    };

    const teamOptions: AutocompleteOption[] = data.teams.map(team => ({
        label: `${team.name}`,
        value: team.id,
        keywords: `${team.name}, ${team.Project}, ${team.teamLead}`,
        meta: {}
    }));

    const memberOptions: AutocompleteOption[] = data.members.map(member => ({
        label: `${member.firstName} ${member.lastName}`,
        value: member.id,
        keywords: `${member.firstName} ${member.lastName}, ${member.firstName}, ${member.lastName}, ${member.discordProfileName}`,
        meta: {}
    }));

    function onTeamSelection(event: CustomEvent<AutocompleteOption>): void {
        input = event.detail.label;
        teamId = event.detail.value as string;
        // console.log("Selected Team ID:", teamId); // Debugging line
    }


    function onMemberSelection(event: CustomEvent<AutocompleteOption>): void {
        memInput = event.detail.label;  // Update input field with selected admin's name
        memIdList = [...memIdList, event.detail.value as string];
        // console.log(event.detail.label);
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
        <h2 class="h2">Appoint Members to a Team</h2>
        
        <br />
        <label class="label">
            <span>Select a Team</span> {#if $errors.teamId}<span class="variant-filled-error badge">{$errors.teamId}</span>{/if}
            <input
            class="input autocomplete"
            type="search"
            name="autocomplete-search-lead"
            bind:value={input}
            placeholder="Search..."
            autocomplete="off"
            use:popup={popupSettingsTeam}
            />
            <div class="card p-4 w-72 shadow-xl scroll_div" data-popup="popupAutocompleteTeam">
            <Autocomplete
              bind:input={input}
              options={teamOptions}
              on:selection={onTeamSelection}
            />
            </div>
        </label>
        
        <br />
        <span>Select Members</span>
        <InputChip bind:input={memInput} bind:value={inputList} name="chips" placeholder="Enter a member then press return" />
        
        <div class="card w-full max-w-sm max-h-48 p-4 overflow-y-auto scroll_div" tabindex="-1">
            <Autocomplete
                bind:input={memInput}
                options={memberOptions}
                denylist={inputList}
                on:selection={onMemberSelection}
            />
        </div>
        <input type="hidden" name="teamId" value={teamId} />
        <input type="hidden" name="members" value={memIdList} />
        <button class="btn variant-ghost-primary mt-4 hover:variant-filled-primary">Done</button>
    </form>
    </div>
</div>
