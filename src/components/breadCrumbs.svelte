<script lang="ts">
	import DashboardButton from './buttons/dashboard-button.svelte';
  import { page } from '$app/stores';

  $: path = $page.route.id?.slice(7).split('/');
</script>

<style>
  .bread{
    font-size: 1rem/* 16px */;
    line-height: 1.5rem/* 24px */;
    padding-left: 1.25rem/* 20px */;
    padding-right: 0.8rem/* 20px */;
    padding-top: 9px;
    padding-bottom: 9px;
    white-space: nowrap;
    text-align: center;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition-property: all;
    transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
    transition-duration: 150ms;
    border-radius: var(--theme-rounded-base);
  }
</style>

<!-- Breadcrumb -->
<nav class="bread variant-ghost-primary hover:variant-filled-primary" aria-label="Breadcrumb">
  <ol class="inline-flex items-center space-x-1 md:space-x-2 rtl:space-x-reverse">
    <li class="inline-flex items-center">
      <a href="/" class="inline-flex items-center text-black-700 hover:text-white dark:text-black-400 dark:hover:text-white">
        <svg class="w-3 h-3 me-2.5" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 20 20">
          <path d="m19.707 9.293-2-2-7-7a1 1 0 0 0-1.414 0l-7 7-2 2a1 1 0 0 0 1.414 1.414L2 10.414V18a2 2 0 0 0 2 2h3a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h3a2 2 0 0 0 2-2v-7.586l.293.293a1 1 0 0 0 1.414-1.414Z"/>
        </svg>
        Home
      </a>
    </li>
    <li>
      <div class="flex items-center">
        <svg class="me-2.5 rtl:rotate-180 block w-3 h-3 mx-1 text-black-400" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 6 10">
          <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m1 9 4-4-4-4"/>
        </svg>
      {#if path != undefined}
        {#each path as crumb, i}
          <!-- If crumb index is less than the breadcrumb length minus 1 -->
          {#if i < path.length - 1}
            <li class="crumb">
              <a class="text-transform: capitalize me-2.5 inline-flex items-center text-black-700 hover:text-white dark:text-black-400 dark:hover:text-white" href="/{crumb}">
                {crumb}
              </a>
            </li>
            <li>
              <div class="flex items-center">
                <svg class="me-2.5 rtl:rotate-180 block w-3 h-3 mx-1 text-black-400" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 6 10">
                  <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m1 9 4-4-4-4"/>
                </svg>
              </div>
            </li>        
          {:else}
            <li class="me-2.5 inline-flex items-center text-black-700 dark:text-black-400 text-transform: capitalize">{crumb}</li>
          {/if}
        {/each}
      {/if}
    </li>
  </ol>
</nav>
