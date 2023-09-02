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

<div class="h-full card">
  <ProjectList data={projects} />
  <br />
  <hr class="!border-t-4" />
  <br />
  <TeamList data={teams} />
</div>
