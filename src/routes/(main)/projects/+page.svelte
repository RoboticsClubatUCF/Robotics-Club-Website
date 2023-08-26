<script lang="ts">
  import type { PageData } from './$types';
  import type projectCategory from '../../../types/projectCategory';
  import ProjectCard from '../../../components/projectCard.svelte';
  import { Accordion, AccordionItem } from '@skeletonlabs/skeleton';

  export let data: PageData;

  const categories: projectCategory[] = [];
  const isYearThisYear = (year: number) => {
    if (year - new Date().getFullYear() == 0) {
      return true;
    }
    return false;
  };
</script>

<div class="w-screen h-11 bg-surface-200-700-token h2">
  <div>Projects</div>
</div>

{#if data.categories.length != 0}
  <Accordion>
    {#each data.categories as categoryByYear}
      <AccordionItem open={isYearThisYear(categoryByYear.year)}>
        <svelte:fragment slot="summary"><h2 class="h2">{categoryByYear.year}</h2></svelte:fragment>
        <svelte:fragment slot="content">
          <Accordion>
            {#each categoryByYear.semester as categoryBySemester}
              <AccordionItem>
                <svelte:fragment slot="summary"
                  ><h3 class="h3">{categoryBySemester.season}</h3></svelte:fragment
                >
                <svelte:fragment slot="content">
                  <section class="grid sm:grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
                    {#each categoryBySemester.projects as project}
                      <ProjectCard {project} />
                    {/each}
                  </section></svelte:fragment
                >
              </AccordionItem>
            {/each}
          </Accordion>
        </svelte:fragment>
      </AccordionItem>
    {/each}
  </Accordion>
{/if}
