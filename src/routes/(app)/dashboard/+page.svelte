<script lang="ts">
  import {
    AppBar,
    AppShell,
    type DrawerSettings,
    getDrawerStore,
    modeCurrent
  } from '@skeletonlabs/skeleton';
  import type { PageServerData } from './$types';
  import { superForm } from 'sveltekit-superforms/client';
  import Feed from '../../../components/dashboard/feed.svelte';
  import LeftSideBar from '../../../components/dashboard/leftSidebar/leftSideBar.svelte';
  import RightSideBar from '../../../components/dashboard/rightSidebar/rightSideBar.svelte';
  import Payments from '../../../components/stripe/payments.svelte';
  import { enhance } from '$app/forms';
  
  export let data: PageServerData;
  const { form, errors, constraints } = superForm(data.form, {
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

  function isSummerPeriod() {
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    
    // Calculate the date of the fourth week in August (matching the original code)
    const august = new Date(currentYear, 7, 1);
    const dayOfWeek = august.getDay();
    const firstDayOfFourthWeek = 22 + (7 - dayOfWeek) % 7;
    const fourthWeekInAugust = new Date(currentYear, 7, firstDayOfFourthWeek);
    
    // Set start date to June 1st
    const startDate = new Date(currentYear, 5, 1);
    
    // console.log("Start: ", startDate);
    // console.log("End: ", fourthWeekInAugust);
    
    return currentDate >= startDate && currentDate <= fourthWeekInAugust;
  }
</script>

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
            
            {#if (data.user?.membershipExpDate.getTime() ?? 0) < new Date().getTime() && isSummerPeriod()}
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
                    Looks like you're all set! Check back in on discord after paying dues for membership status (it updates every 15 minutes), and look out for announcements about updates to this site!
                  </h6>
                {/if}
            {/if}
          </div>
        </div>
        {#if !((data.user?.membershipExpDate.getTime() ?? 0) < new Date().getTime())}
          <br />
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
