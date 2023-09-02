<script lang="ts">
  import type { Picture, Project, Team } from '@prisma/client';
  import ProjectList from './projectList.svelte';
  import TeamList from './teamList.svelte';

  export let projects: (Project & { logo: Picture })[] | null;
  export let teams:
    | (Team & {
        _count: {
          members: number;
        };
      })[]
    | null;
</script>

<div class="h-full variant-filled-surface">
  <ProjectList data={projects} />
  <hr />
  <TeamList data={teams} />
</div>
