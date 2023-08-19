<script lang="ts">
  import type { PageData } from './$types';
  import type projectCategory from '../../../types/projectCategory';
  import ProjectCard from '../../../components/projectCard.svelte';

  export let data: PageData;

  const categories: projectCategory[] = [];
</script>

<div class="w-screen h-11 bg-surface-200-700-token h2">
  <div>Active Projects</div>
</div>

{#if data.categories.length != 0}
  {#each data.categories as categoryByYear}
    <div class="w-screen h-11 bg-surface-300-600-token h2">
      <div>{categoryByYear.year}</div>
    </div>
    {#each categoryByYear.semester as categoryBySemester}
      <div class="w-screen h-11 bg-surface-400-500-token h2">
        <div>{categoryBySemester.season}</div>
      </div>
      <section class="grid grid-cols-2 md:grid-cols-3 gap-4">
        {#each categoryBySemester.projects as project}
          <ProjectCard {project} />
        {/each}
      </section>
    {/each}
  {/each}
{/if}
