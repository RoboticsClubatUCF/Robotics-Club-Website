<script lang="ts">
  import type { Picture, Project } from '@prisma/client';

  export let project: Project & { logo: Picture };
  let hover = false;
</script>

<a href="./projects/{project.id}">
  <div
    class="card h-72 max-w-72 rounded-lg relative"
    on:mouseenter={() => {
      hover = true;
    }}
    on:mouseleave={() => {
      hover = false;
    }}
  >
    {#if !hover}
      <!-- if not hovering, just show the picture and the title over it -->
      {#if project.logo.isLocal}
        <!-- load the image using the b64 method -->
      {:else}
        <div class="absolute h3 p-5">{project.title}</div>
        <img class="h-72 rounded-lg object-cover overflow-hidden" src={project.logo.data} alt="" />
      {/if}
    {:else}
      <!-- if hovering, display the goods -->
      <div class="absolute p-5">
        <h3 class="h3">{project.title}</h3>
        <p>{project.description}</p>
        {#each project.Skills as skill}
          <span class="badge variant-filled-surface">{skill}</span>
        {/each}
      </div>
    {/if}
  </div></a
>
