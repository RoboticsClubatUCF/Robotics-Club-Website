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
  import EditableText from '../../components/EditableText.svelte';
  import EditableLink from '../../components/EditableLink.svelte';
  import type { PageData } from './$types';
  export let data: PageData;
  export let params: Record<string, string>;
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
  <h2 class="centered h2">
    <EditableText
      contentKey="home.section.team"
      value={data.siteContent.sections.team}
      editMode={data.editMode}
      multiline={false}
    />
  </h2>
  <Admins officers={data.officers} editMode={data.editMode} />
</div>

<div class="m-4 mt-8">
  <h2 class="centered h2">
    <EditableText
      contentKey="home.section.faq"
      value={data.siteContent.sections.faq}
      editMode={data.editMode}
      multiline={false}
    />
  </h2>
  <FRQ items={data.siteContent.faqItems} editMode={data.editMode} />
</div>

<div class="m-4">
  <h2 class="centered h2">
    <EditableText
      contentKey="home.section.socials"
      value={data.siteContent.sections.socials}
      editMode={data.editMode}
      multiline={false}
    />
  </h2>
  <br />
  <div class="logo-cloud grid-cols-2 lg:!grid-cols-2 gap-2">
    <EditableLink
      contentKey="home.social.discord"
      href={data.siteContent.socials.discord}
      editMode={data.editMode}
      linkClass="logo-item"
    >
      <div class="h-10 w-10"><FaDiscord /></div>
      <span>Discord</span>
    </EditableLink>

    <EditableLink
      contentKey="home.social.github"
      href={data.siteContent.socials.github}
      editMode={data.editMode}
      linkClass="logo-item"
    >
      <div class="h-10 w-10"><FaGithub /></div>
      <span>Github</span>
    </EditableLink>

    <EditableLink
      contentKey="home.social.instagram.club"
      href={data.siteContent.socials.instagramClub}
      editMode={data.editMode}
      linkClass="logo-item"
    >
      <div class="h-10 w-10"><FaInstagram /></div>
      <span>Instagram (Club)</span>
    </EditableLink>

    <EditableLink
      contentKey="home.social.instagram.tapemeasure"
      href={data.siteContent.socials.instagramTapemeasure}
      editMode={data.editMode}
      linkClass="logo-item"
    >
      <div class="h-10 w-10"><FaInstagram /></div>
      <span>Instagram (Tapemeasure)</span>
    </EditableLink>
  </div>
</div>
