<script lang="ts">
  import type { Prisma } from '@prisma/client';

  export let project: Prisma.ProjectGetPayload<{ include: { logo: true } }>;
  let hover = false;

  function truncateDescription(description: string): string {
    const sentences = description.split('. ').filter((s) => s.trim() !== '');
    return sentences.length > 2
      ? `${sentences.slice(0, 2).join('. ')}...`
      : description;
  }
</script>

<a href="/projects/{project.id}">
  <!-- Mobile layout: always shows title + description -->
  <div class="card md:hidden p-3 space-y-1">
    {#if project.logo}
      <img
        class="w-full h-32 rounded object-contain mb-2"
        src={project.logo.data}
        alt={project.title}
      />
    {/if}
    <h3 class="h5 font-bold">{project.title}</h3>
    <p class="text-sm line-clamp-3 opacity-70">{truncateDescription(project.description)}</p>
    <div class="flex flex-wrap gap-1 mt-1">
      {#each project.Skills as skill}
        <span class="badge variant-filled-surface text-xs">{skill}</span>
      {/each}
    </div>
  </div>

  <!-- Desktop layout: hover to reveal details -->
  <div
    role="presentation"
    class="hidden md:block card h-72 max-w-72 rounded-lg relative overflow-hidden"
    on:mouseenter={() => { hover = true; }}
    on:mouseleave={() => { hover = false; }}
  >
    {#if !hover}
      {#if project.logo?.isLocal}
        <!-- local image placeholder -->
      {:else if project.logo}
        <div class="absolute m-5 p-2 h3 rounded-lg variant-filled-surface">{project.title}</div>
        <img
          class="h-72 w-full rounded-lg object-contain overflow-hidden"
          src={project.logo.data}
          alt=""
        />
      {/if}
    {:else}
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
