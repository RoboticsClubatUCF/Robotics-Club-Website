<script lang="ts">
  import type { Prisma, Team } from '@prisma/client';
  import ProjectList from './projectList.svelte';
  import TeamList from './teamList.svelte';

  export let projects: Prisma.ProjectGetPayload<{ include: { logo: true } }>[] | undefined | null;
  export let teams:
    | (Team & {
        _count: {
          members: number;
        };
      })[]
    | undefined
    | null;
</script>

<div class="h-full card m-2 p-4">
  <ProjectList data={projects} />
  <br />
  <hr class="!border-t-4" />
  <br />
  <TeamList data={teams} />
</div>
