<script lang="ts">
  import Competition from '../../components/cards/competition.svelte';
  import MissionStatement from '../../components/cards/missionStatement.svelte';
  import Outreach from '../../components/cards/outreach.svelte';
  import Projects from '../../components/cards/projects.svelte';
  import Research from '../../components/cards/research.svelte';
  import Teaching from '../../components/cards/teaching.svelte';
  import Hero from '../../components/hero.svelte';
  import type { PageServerData } from './$types';
  export let data: PageServerData;
</script>

<div class="w-full">
  <Hero />
</div>

<!-- Page Content -->
<hr />
<div class="grid grid-cols-1 md:grid-cols-3 gap-8 p-8 w-full">
  <MissionStatement />
  <Projects totalProjects={data.projectCount} />
  <Teaching />
  <Outreach />
  <Competition />
  <Research />
</div>

<style>
</style>
