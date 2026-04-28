<script lang="ts">
  import { modeCurrent } from '@skeletonlabs/skeleton';
  import PieChart from '../../../../components/dashboard/PieChart.svelte';
  import type { PageData } from './$types';

  export let data: PageData;

  let selectedKey = data.statGroups[0]?.key ?? '';

  $: selected = data.statGroups.find((g) => g.key === selectedKey) ?? data.statGroups[0];
</script>

<div class="p-6 max-w-3xl mx-auto space-y-6">
  <!-- Header -->
  <div>
    <h1 class="h2">Club Statistics</h1>
    <p class="text-sm opacity-60 mt-1">
      {data.totalMembers} registered members · {data.totalSurveys} surveys completed
    </p>
  </div>

  <!-- Dropdown -->
  <div class="flex items-center gap-3">
    <label for="stat-select" class="text-sm font-semibold shrink-0">View:</label>
    <select id="stat-select" bind:value={selectedKey} class="select max-w-sm">
      {#each data.statGroups as group}
        <option value={group.key}>{group.label}</option>
      {/each}
    </select>
  </div>

  <!-- Chart card -->
  {#if selected}
    <div class={$modeCurrent
      ? 'card p-6 shadow-xl shadow-surface-300'
      : 'card p-6 shadow-xl shadow-surface-500'}>
      <PieChart items={selected.items} title={selected.label} />
    </div>
  {/if}
</div>
