<script lang="ts">
  import FaDiscord from 'svelte-icons/fa/FaDiscord.svelte';
  import FaInstagram from 'svelte-icons/fa/FaInstagram.svelte';
  import FaGithub from 'svelte-icons/fa/FaGithub.svelte';
  import Competition from '../../components/cards/competition.svelte';
  import MissionStatement from '../../components/cards/missionStatement.svelte';
  import Outreach from '../../components/cards/outreach.svelte';
  import Projects from '../../components/cards/projects.svelte';
  import Research from '../../components/cards/research.svelte';
  import Teaching from '../../components/cards/teaching.svelte';
  import Hero from '../../components/hero.svelte';
  import Admins from '../../components/cards/admins.svelte';
  import FRQ from '../../components/frq.svelte';
  import type { PageServerData } from './$types';
  export let data: PageServerData;
</script>

<style>
  .centered {
    max-width: 100vw; /* Can be in percentage also. */
    height: auto;
    margin: 0 auto;
    position: relative;
    text-align: center;
    animation: fadeIn 3s;
  }
</style>

<div class="w-full">
  <Hero />
</div>

<!-- Page Content -->
<div class="grid md:grid-cols-3 gap-8 p-4 w-full">
  <MissionStatement />
  <Projects totalProjects={data.projectCount} />
  <Teaching />
  <Outreach />
  <Competition />
  <Research />
</div>

<div class="m-4">
  <h2 class="centered h2">Meet the Team!</h2>
  <Admins />
</div>

<div class="m-4" style="margin-top: 2rem">
  <h2 class="centered h2">Frequently Asked Questions!</h2>
  <FRQ />
</div>

<div class="m-4">
  <h2 class="centered h2">Check out our Socials!</h2>
  <br />
  <div class="logo-cloud grid-cols-2 lg:!grid-cols-2 gap-2">
    <a class="logo-item" href="https://discord.gg/m8XZahpNjR">
      <div class="h-10 w-10"><FaDiscord /></div>
      <span>Discord</span>
    </a>
    <a class="logo-item" href="https://github.com/RoboticsClubatUCF">
      <div class="h-10 w-10"><FaGithub /></div>
      <span>Github</span>
    </a>
    <a class="logo-item" href="https://www.instagram.com/ucf_robotics/">
      <div class="h-10 w-10"><FaInstagram /></div>
      <span>Instagram (Club)</span>
    </a>
    <a class="logo-item" href="https://instagram.com/ucf.tapemeasure/">
      <div class="h-10 w-10"><FaInstagram /></div>
      <span>Instagram (Tapemeasure)</span>
    </a>
    <!-- Add more Sodials below -->
  </div>
</div>
