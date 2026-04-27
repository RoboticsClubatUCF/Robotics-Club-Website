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

<div class="w-full">
  <Hero slogan={data.siteContent.slogan} editMode={data.editMode} />
</div>

<!-- Page Content -->
<div class="grid md:grid-cols-3 gap-8 p-4 w-full">
  <MissionStatement
    text={data.siteContent.missionStatement}
    image={data.siteContent.cardImages.mission}
    editMode={data.editMode}
  />
  <Projects
    totalProjects={data.projectCount}
    text={data.siteContent.projectStatement}
    image={data.siteContent.cardImages.projects}
    editMode={data.editMode}
  />
  <Teaching
    text={data.siteContent.teachingStatement}
    image={data.siteContent.cardImages.teaching}
    editMode={data.editMode}
  />
  <Outreach
    text={data.siteContent.outreachStatement}
    image={data.siteContent.cardImages.outreach}
    editMode={data.editMode}
  />
  <Competition
    text={data.siteContent.competitionStatement}
    image={data.siteContent.cardImages.competition}
    editMode={data.editMode}
  />
  <Research
    text={data.siteContent.researchStatement}
    image={data.siteContent.cardImages.research}
    editMode={data.editMode}
  />
</div>

<div class="m-4">
  <h2 class="centered h2">Meet the Team!</h2>
  <Admins officers={data.officers} editMode={data.editMode} />
</div>

<div class="m-4 mt-8">
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
    <a class="logo-item" href="https://www.instagram.com/rccf.tapemeasure/">
      <div class="h-10 w-10"><FaInstagram /></div>
      <span>Instagram (Tapemeasure)</span>
    </a>
  </div>
</div>
