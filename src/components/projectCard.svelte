<script lang="ts">
  import type { Prisma } from '@prisma/client';

  export let project: Prisma.ProjectGetPayload<{ include: { logo: true } }>;
  let hover = false;

  // Function to truncate the description to 2 sentences
  function truncateDescription(description: string): string {
    const sentences = description.split('. ').filter((s) => s.trim() !== '');
    return sentences.length > 2
      ? `${sentences.slice(0, 2).join('. ')}...`
      : description;
  }
</script>

<a
  href="/projects/{project.id}"
  on:mouseenter={() => { hover = true; }}
  on:mouseleave={() => { hover = false; }}
>
  <div class="card h-72 max-w-72 rounded-lg relative overflow-hidden">
    {#if !hover}
      <!-- if not hovering, just show the picture and the title over it -->
      {#if project.logo?.isLocal}
        <!-- load the image using the b64 method -->
      {:else if project.logo}
        <div class="absolute m-5 p-2 h3 rounded-lg variant-filled-surface">{project.title}</div>
        <img
          class="h-72 w-full rounded-lg object-contain overflow-hidden"
          src={project.logo.data}
          alt=""
        />
      {/if}
    {:else}
      <!-- if hovering, display the goods -->
      <div class="absolute p-2">
        <h3 class="h3 m-5">{project.title}</h3>
        <p class="line-clamp-6 text-sm">{truncateDescription(project.description)}</p>
        {#each project.Skills as skill}
          <span class="badge variant-filled-surface">{skill}</span>
        {/each}
      </div>
    {/if}
  </div>
</a>
