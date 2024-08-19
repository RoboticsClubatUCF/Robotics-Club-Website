<script lang="ts">
  import {
    AppBar,
    AppShell,
    type DrawerSettings,
    getDrawerStore,
    modeCurrent,
  } from '@skeletonlabs/skeleton';
  import type { PageServerData } from './$types';
  import { superForm } from 'sveltekit-superforms/client';
  import Feed from '../../../components/dashboard/feed.svelte';
  import LeftSideBar from '../../../components/dashboard/leftSidebar/leftSideBar.svelte';
  import RightSideBar from '../../../components/dashboard/rightSidebar/rightSideBar.svelte';
  import Payments from '../../../components/stripe/payments.svelte';
  import { enhance } from '$app/forms';
  import { Autocomplete, popup } from '@skeletonlabs/skeleton';
  import type { AutocompleteOption, PopupSettings } from '@skeletonlabs/skeleton';
  import successToast from '../../../components/toasts/successToast';
  import failToast from '../../../components/toasts/failToast';
  
  export let data: PageServerData;
  const { form, errors, constraints, message } = superForm(data.form, {
    clearOnSubmit: 'errors-and-message'
  });

  const drawerStore = getDrawerStore();

  const drawerSettingsLeft: DrawerSettings = {
    id: 'dashboard1',
    meta: {
      projects: data.user?.Projects,
      teams: data.user?.Teams
    }
  };

  const drawerSettingsRight: DrawerSettings = {
    id: 'dashboard2',
    position: 'right',
    meta: {
      projects: data.availableProjects
    }
  };

  // Determine if survey update is needed
  let promptSurveyUpdate = false;
  const surveyDateUpdated = new Date(data.user?.Survey?.DateUpdated!);
  const currentDate = new Date();

  const getPeriodStartDate = (month: number) => {
    return new Date(currentDate.getFullYear(), month, 1);
  };

  const checkPeriods = [
    { start: getPeriodStartDate(0), end: getPeriodStartDate(4) }, // Jan-Apr
    { start: getPeriodStartDate(4), end: getPeriodStartDate(8) }, // May-Aug
    { start: getPeriodStartDate(8), end: getPeriodStartDate(0) }  // Sep-Dec
  ];

  for (let period of checkPeriods) {
    if (currentDate >= period.end && surveyDateUpdated < period.end && surveyDateUpdated >= period.start) {
      promptSurveyUpdate = true;
      break;
    }
  }
  
  let selectedMemberId: string | null = null;
  let change: boolean | null = false;
  let input: string = '';

  let popupSettings: PopupSettings = {
    event: 'focus-click',  // Trigger popup on focus and click
    target: 'popupAutocomplete',  // The ID to target for the popup
    placement: 'bottom'  // Position the popup below the input
  };

  // Map members from the database for autocomplete options
  const memberOptions: AutocompleteOption[] = data.members.map(member => ({
    label: `${member.firstName} ${member.lastName}`,
    value: member.id,
    keywords: `${member.firstName} ${member.lastName}, ${member.discordProfileName}`,
    meta: {}
  }));

  // Handle member selection from autocomplete
  function onMemberSelection(event: CustomEvent<AutocompleteOption>): void {
    input = event.detail.label;  // Update input field with selected member's name
    selectedMemberId = event.detail.value as string | null;  // Store selected member ID
    console.log(selectedMemberId);
  }

  let selectedAdminId: string | null = null;
  let changeAdmin: boolean | null = false;
  let adminInput: string = '';

function onAdminSelection(event: CustomEvent<AutocompleteOption>): void {
  adminInput = event.detail.label;  // Update input field with selected admin's name
  selectedAdminId = event.detail.value as string | null;  // Store selected admin ID
  console.log(selectedAdminId);
}

$: if ($message === 'OK') {
  successToast('Configuration Updated Successfully!');
}else if ($message === 'NO') {
  failToast('Error 404, Member Not Found');
}

</script>

<style>
.scroll_div{
  overflow: auto;
  max-height: 100px;
}
</style>

<AppShell>
  <svelte:fragment slot="header">
    <AppBar>
      <svelte:fragment slot="lead">
        <button
          class="block lg:hidden btn variant-ghost-tertiary hover:variant-filled-tertiary"
          on:click={() => {
            drawerStore.open(drawerSettingsLeft);
          }}>Projects & Teams</button>
        <button
          class="block lg:hidden btn variant-ghost-tertiary hover:variant-filled-tertiary"
          on:click={() => {
            drawerStore.open(drawerSettingsRight);
          }}>Available Projects</button>
      </svelte:fragment>
    </AppBar>
  </svelte:fragment>
  
  <svelte:fragment slot="sidebarLeft">
    {#if !((data.user?.membershipExpDate.getTime() ?? 0) < new Date().getTime())}
      <div id="sidebar-left" class="hidden lg:block">
        <LeftSideBar projects={data.user?.Projects} teams={data.user?.Teams} />
      </div>
    {/if}
  </svelte:fragment>
  
  <svelte:fragment slot="sidebarRight">
    {#if !((data.user?.membershipExpDate.getTime() ?? 0) < new Date().getTime())}
      <div id="sidebar-right" class="hidden lg:block">
        <RightSideBar projects={data.availableProjects} />
      </div>
    {/if}
  </svelte:fragment>
  
  {#if data.user && data.user.surveyId !== null}
    {#if promptSurveyUpdate}
      <div class="m-4">
        <div class={$modeCurrent ? 'block card p-8 pointer-events-auto shadow-m shadow-surface-300 justify-center' : 'block card p-8 pointer-events-auto shadow-m shadow-surface-500 justify-center'}>
          <div class="p-2 rounded-md">
            <h2 class="h2">Uh Oh! looks like your members survey has expired...</h2>
            <span> </span>
            <br/>
            <h3 class="h3">The members survey is a requirement for anyone trying to become a member of RCCF!
              You can update yours in your profile by clicking on the avatar in the top right corner!
            </h3>
          </div>
        </div>
      </div>
    {:else}
      <div class="m-4">
        <div class={$modeCurrent ? 'block card p-8 pointer-events-auto shadow-m shadow-surface-300 justify-center' : 'block card p-8 pointer-events-auto shadow-m shadow-surface-500 justify-center'}>
          <div class="p-2 rounded-md">
            <h2 class="h2">
              Hello {data.user?.firstName}
              {#if data.user?.lastName}
                {data.user?.lastName},
              {/if}
            </h2>
            <br />
            
            {#if (data.user?.membershipExpDate.getTime() ?? 0) < new Date().getTime() && new Date().getMonth() <= 8 && new Date().getMonth() >= 4}
              {#if data.user?.id}
                <form action="?/summerRole" method="post" use:enhance>
                  <input type="hidden" name="id" bind:value={data.user.id} />
                  <button type="submit" class="btn variant-ghost-tertiary hover:variant-filled-tertiary">Join As a Summer Member!</button>
                </form>
              {/if}
              {:else}
                {#if (data.user?.membershipExpDate.getTime() ?? 0) < new Date().getTime()}
                  <h6 class="badge variant-filled-error">Looks like your dues are expired!</h6>
                  <hr />
                  <br class="h-5" />
                  {#if data.user?.id}
                    <Payments userID={data.user?.id} />
                {/if}
                {:else}
                  <h6 class="badge variant-filled-success">Your Dues Expire On {data.user?.membershipExpDate.toDateString()}</h6>
                  <h6 class="h6">
                    Looks like you're all set! Check back in on discord after paying dues for membership status (it can take a second or two), and look out for announcements about updates to this site!
                  </h6>
                {/if}
            {/if}
          </div>
        </div>
        {#if !((data.user?.membershipExpDate.getTime() ?? 0) < new Date().getTime())}
          <br />
        {/if}
        
        {#if data.user?.role.permissionLevel > 1}
        <div class={$modeCurrent ? 'block card p-8 pointer-events-auto shadow-m shadow-surface-300 justify-center' : 'block card p-8 pointer-events-auto shadow-m shadow-surface-500 justify-center'}>
          <div class="p-2 rounded-md">
            <h2 class="h2">
              {data.user?.role?.name?.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')} Dashboard
            </h2>
            <!-- Get to set president, admin, & officers -->
            {#if data.user?.role.permissionLevel >= 5}
              <br />
              {#if data.user?.role.name === "admin"}
              <div>
                <h6 class="h5">
                  Configure President Position
                </h6>
                {#if data.currentPresident && !change}
                  <p>Current President: {data.currentPresident.firstName} {data.currentPresident.lastName}</p>
                  <button type="submit" class="btn variant-ghost-tertiary hover:variant-filled-tertiary mt-1" on:click={() => selectedMemberId = null} on:click={() => change = true}>Change</button>
                {/if}
    
                {#if !data.currentPresident || change}
                  <input
                    class="input autocomplete"
                    type="search"
                    name="autocomplete-search"
                    bind:value={input}
                    placeholder="Search for a member..."
                    use:popup={popupSettings}
                  />
                  <div class="card p-4 w-72 shadow-xl scroll_div" data-popup="popupAutocomplete">
                    <Autocomplete
                      bind:input={input}
                      options={memberOptions}
                      on:selection={onMemberSelection}
                    />
                  </div>
                  <form action="?/changePresident" method="post" use:enhance on:submit={() => change = false}>
                    <input type="hidden" name="presidentId" value={selectedMemberId} />
                    <button type="submit" class="btn variant-ghost-tertiary hover:variant-filled-tertiary mt-2">Confirm Appointment</button>
                  </form>
                {/if}
              </div>
              {/if}
              {#if data.user?.role.name === "president"}
              <div>
                <h6 class="h5">Configure Admin Position</h6>
                
                {#if data.currentAdmin && !changeAdmin}
                  <p>Current Admin: {data.currentAdmin.firstName} {data.currentAdmin.lastName}</p>
                  <button type="submit" class="btn variant-ghost-tertiary hover:variant-filled-tertiary mt-1" on:click={() => selectedAdminId = null} on:click={() => changeAdmin = true}>Change Admin</button>
                {/if}
            
                {#if !data.currentAdmin || changeAdmin}
                  <input
                    class="input autocomplete"
                    type="search"
                    name="autocomplete-search-admin"
                    bind:value={adminInput}
                    placeholder="Search for a member..."
                    use:popup={popupSettings}
                  />
                  <div class="card p-4 w-72 shadow-xl scroll_div" data-popup="popupAutocomplete">
                    <Autocomplete
                      bind:input={adminInput}
                      options={memberOptions}
                      on:selection={onAdminSelection}
                    />
                  </div>
                  <form action="?/changeAdmin" method="post" use:enhance on:submit={() => changeAdmin = false}>
                    <input type="hidden" name="adminId" value={selectedAdminId} />
                    <button type="submit" class="btn variant-ghost-tertiary hover:variant-filled-tertiary mt-2">Confirm Appointment</button>
                  </form>
                {/if}
              </div>
            {/if}
                        
            {/if}
              <!-- Get to set project leads-->
            {#if data.user?.role.permissionLevel >= 4}
              <br />
              <h6 class="h5">
                Configure Project Leads
              </h6>
            {/if}
              <!-- Get to create teams & set team leads -->
            {#if data.user?.role.permissionLevel >= 3}
              <br />
              <h6 class="h5">
                Configure Teams & Team Leads
              </h6>
            {/if}
              <!-- Get to assign people into their team -->
            {#if data.user?.role.permissionLevel >= 2}
              <br />
              <h6 class="h5">
                Configure Teams
              </h6>
            {/if}
          </div>
        </div>
        {/if}

        {#if (data.user?.membershipExpDate.getTime() ?? 0) > new Date().getTime()}
          <Feed />
        {/if}
      </div>
    {/if}
  {:else}
    <div class="m-4">
      <div class={$modeCurrent ? 'block card p-8 pointer-events-auto shadow-m shadow-surface-300 justify-center' : 'block card p-8 pointer-events-auto shadow-m shadow-surface-500 justify-center'}>
        <div class="p-2 rounded-md">
          <h2 class="h2">Oops looks like you haven't filled out a members survey yet...</h2>
          <span> </span>
          <br/>
          <h3 class="h3">The members survey is a requirement for anyone trying to become a member of RCCF!
            It's a quick 1-3 minute survey on some general and important information about you as a possible member!
            You can create one with the button below and if you need to change it later you can update your survey in your profile by clicking on the avatar in the top right corner!
          </h3>
          <br/>
          <a id="survey" href="/dashboard/survey" class="btn variant-ghost-tertiary hover:variant-filled-tertiary">Create a Members Survey</a>
        </div>
      </div>
    </div>
  {/if}
</AppShell>
