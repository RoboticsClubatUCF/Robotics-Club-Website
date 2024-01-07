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
  import { onMount } from 'svelte';
  import PayDues from '../../../components/paypal/payDues.svelte';
  import Feed from '../../../components/dashboard/feed.svelte';
  import LeftSideBar from '../../../components/dashboard/leftSidebar/leftSideBar.svelte';
  import RightSideBar from '../../../components/dashboard/rightSidebar/rightSideBar.svelte';
  export let data: PageServerData;
  let email = data.user!.email;

  let mounted = false;
  const { form, errors, constraints } = superForm(data.form, {
    clearOnSubmit: 'errors-and-message'
  });
  onMount(() => {
    mounted = true;
  });
  let paymentSuccess = {
    success: false,
    duesType: 1
  };

  $: if (paymentSuccess.success) {
    if (mounted) {
      document.getElementById('submitPaypal')?.click();
      // document.getElementById('survey')?.click();
    }
  }
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
</script>

<AppShell>
  <svelte:fragment slot="header">
    <AppBar>
      <svelte:fragment slot="lead">
        <button
          class="block lg:hidden btn variant-ghost-tertiary hover:variant-filled-tertiary"
          on:click={() => {
            drawerStore.open(drawerSettingsLeft);
          }}>Projects & Teams</button
        >
        <button
          class="block lg:hidden btn variant-ghost-tertiary hover:variant-filled-tertiary"
          on:click={() => {
            drawerStore.open(drawerSettingsRight);
          }}>Available Projects</button
        >
      </svelte:fragment>
    </AppBar>
  </svelte:fragment>
  <svelte:fragment slot="sidebarLeft">
    <!-- Hidden below Tailwind's large breakpoint -->
    {#if !((data.user?.membershipExpDate.getTime() ?? 0) < new Date().getTime())}
      <div id="sidebar-left" class="hidden lg:block">
        <LeftSideBar projects={data.user?.Projects} teams={data.user?.Teams} />
      </div>
    {/if}
  </svelte:fragment>
  <svelte:fragment slot="sidebarRight">
    <!-- Hidden below Tailwind's large breakpoint -->
    {#if !((data.user?.membershipExpDate.getTime() ?? 0) < new Date().getTime())}
      <div id="sidebar-right" class="hidden lg:block">
        <RightSideBar projects={data.availableProjects} />
      </div>
    {/if}
  </svelte:fragment>
  <div class="m-4">
    <Feed />
    <div
      class={$modeCurrent
        ? 'block card p-8 pointer-events-auto shadow-m card-hover shadow-surface-300 justify-center'
        : 'block card p-8 pointer-events-auto shadow-m card-hover shadow-surface-500 justify-center'}
    >
      <div class="p-2 rounded-md">
        <h2 class="h2">Hello {data.user?.firstName},</h2>
        <br />
        {#if (data.user?.membershipExpDate.getTime() ?? 0) < new Date().getTime()}
          <h6 class="badge variant-filled-error">Looks like your dues are expired!</h6>
          <hr />
          <br class="h-5" />
          <PayDues bind:purchaseSuccess={paymentSuccess} />
          <form method="post" action="?/dues">
            <input type="hidden" name="email" id="email" bind:value={email} />
            <input
              type="hidden"
              name="duesType"
              id="duesType"
              bind:value={paymentSuccess.duesType}
            />
            <button style="visibility: hidden;" type="submit" id="submitPaypal" />
          </form>
        {:else}
          <h6 class="badge variant-filled-success">
            Your Dues expire on {data.user?.membershipExpDate.toDateString()}
          </h6>
          <h6 class="h6">
            Looks like you're all set! check back in on discord in about a day after paying dues for
            membership status, and look out for announcements about updates to this site!
          </h6>
          <a
            id="survey"
            target="_blank"
            href="https://docs.google.com/forms/d/e/1FAIpQLSc8G4hIVlv9rUusUO6Kb1eZZ-uGbS5TPp0Agi4LYsZZGoHkJQ/viewform?usp=sf_link"
            class="btn variant-ghost-tertiary hover:variant-filled-tertiary">Member Survey</a
          >
        {/if}
      </div>
    </div>
    {#if !((data.user?.membershipExpDate.getTime() ?? 0) < new Date().getTime())}
      <br />
      <!-- <SumoBotsSignUp /> -->
      <!-- <div
        class={$modeCurrent
          ? 'block card p-8 pointer-events-auto shadow-xl shadow-surface-300 sm:w-screen md:w-5/6 justify-center card-hover'
          : 'block card p-8 pointer-events-auto shadow-xl shadow-surface-500 sm:w-screen md:w-5/6 justify-center card-hover'}
      >
        <div class="p-2 rounded-md">
          <h2 class="h2">Test Planka</h2>
          <br />
          <div>
          </div>
          <button
            class="btn variant-ghost-secondary hover:variant-filled-secondary"
            on:click={callPlanka}>Register</button
          >
        </div>
      </div> -->
    {/if}
  </div>
</AppShell>

<!-- This entire page needs to be re-done to allow for the new dashboard -->
<!-- <div
  class="h-screen grid grid-cols-2 place-items-center absolute w-screen top-0 pointer-events-none overflow-scroll"
>
  <div
    class={$modeCurrent
      ? 'block card p-8 pointer-events-auto shadow-xl shadow-surface-300 sm:w-screen md:w-5/6 justify-center'
      : 'block card p-8 pointer-events-auto shadow-xl shadow-surface-500 sm:w-screen md:w-5/6 justify-center'}
  >
    <div class="p-2 rounded-md">
      <h2 class="h2">Hello {data.user?.firstName},</h2>
      <br />
      {#if (data.user?.membershipExpDate.getTime() ?? 0) < new Date().getTime()}
        <h6 class="badge variant-filled-error">Looks like your dues are Expired!</h6>
        <hr />
        <br class="h-5" />
        <PayDues bind:purchaseSuccess={paymentSuccess} />
        <form method="post">
          <input type="hidden" name="email" id="email" bind:value={email} />
          <input type="hidden" name="duesType" id="duesType" bind:value={paymentSuccess.duesType} />
          <button style="visibility: hidden;" type="submit" id="submitPaypal" />
        </form>
      {:else}
        <h6 class="badge variant-filled-success">
          Your Dues expire on {data.user?.membershipExpDate.toDateString()}
        </h6>
        <h6 class="h6">
          Looks like you're all set! check back in on discord in about a day after paying dues for
          membership status, and look out for announcements about updates to this site!
        </h6>
        <a
          id="survey"
          target="_blank"
          href="https://docs.google.com/forms/d/e/1FAIpQLSc8G4hIVlv9rUusUO6Kb1eZZ-uGbS5TPp0Agi4LYsZZGoHkJQ/viewform?usp=sf_link"
          class="btn variant-ghost-tertiary hover:variant-filled-tertiary">Member Survey</a
        >
      {/if}
    </div>
  </div>
</div> -->
