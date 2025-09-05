<script lang="ts">
  import type { Picture, Project } from '@prisma/client';

  export let project: Project & { logo: Picture };
  let hover = false;

  // Function to truncate description to 2 sentences
  function truncateDescription(description: string): string {
    const sentences = description.split('. ').filter((s) => s.trim() !== '');
    return sentences.length > 2
      ? `${sentences.slice(0, 2).join('. ')}...`
      : description;
  }
</script>

<a href="/projects/{project.id}">
  <div
    class="card h-72 max-w-72 rounded-lg relative flex flex-col"
    on:mouseenter={() => {
      hover = true;
    }}
    on:mouseleave={() => {
      hover = false;
    }}
  >
    <!-- Project Title Section -->
    <div class="p-4 text-center">
      <h3 class="h3 font-bold">{project.title}</h3>
    </div>

    <!-- Image and Hover Details -->
    <div class="relative flex-1">
      {#if !hover}
        <!-- if not hovering, just show the picture -->
        {#if project.logo.isLocal}
          <!-- load the image using the b64 method -->
        {:else}
          <img
            class="h-full w-full rounded-lg object-contain overflow-hidden"
            src={project.logo.data}
            alt=""
          />
        {/if}
      {:else}
        <!-- if hovering, display the goods -->
        <div class="absolute inset-0 p-4 bg-white bg-opacity-80 flex flex-col justify-center items-center rounded-lg">
          <p class="mb-2 text-center">{truncateDescription(project.description)}</p>
          <div class="flex flex-wrap gap-2 justify-center">
            {#each project.Skills as skill}
              <span class="badge variant-filled-surface">{skill}</span>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </div>
</a>
