<script lang="ts">
  import FaDiscord from 'svelte-icons/fa/FaDiscord.svelte';
  import FaInstagram from 'svelte-icons/fa/FaInstagram.svelte';
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
<div class=" m-8 p-2">
  <h2 class="h2">Check out our Socials!</h2>
  <br />
  <div class="logo-cloud grid-cols-3 lg:!grid-cols-3 gap-1">
    <a class="logo-item" href="https://discord.gg/m8XZahpNjR">
      <div class="h-10 w-10"><FaDiscord /></div>
      <span>Discord</span>
    </a>
    <a class="logo-item" href="https://www.instagram.com/ucf_robotics/">
      <div class="h-10 w-10"><FaInstagram /></div>
      <span>Instagram</span>
    </a>

    <!-- Add more Sodials below -->
  </div>
</div>

<style>
</style>
