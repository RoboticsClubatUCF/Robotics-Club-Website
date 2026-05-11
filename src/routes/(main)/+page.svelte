<svelte:head>
  <title>Robotics Club of Central Florida</title>
</svelte:head>

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

  let cardOrder = [...data.cardOrder];
  let dragging: string | null = null;
  let dragOver: string | null = null;

  function handleDragStart(e: DragEvent, cardName: string) {
    dragging = cardName;
    e.dataTransfer!.effectAllowed = 'move';
  }

  function handleDragOver(e: DragEvent, cardName: string) {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    dragOver = cardName;
  }

  function handleDrop(e: DragEvent, targetCard: string) {
    e.preventDefault();
    if (!dragging || dragging === targetCard) {
      dragging = null;
      dragOver = null;
      return;
    }
    const fromIdx = cardOrder.indexOf(dragging);
    const toIdx = cardOrder.indexOf(targetCard);
    const newOrder = [...cardOrder];
    newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, dragging!);
    cardOrder = newOrder;
    dragging = null;
    dragOver = null;
    saveOrder(newOrder);
  }

  function handleDragEnd() {
    dragging = null;
    dragOver = null;
  }

  async function saveOrder(order: string[]) {
    await fetch('/api/site-content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'home.card.order', value: JSON.stringify(order), type: 'json' })
    });
  }
</script>

<div class="w-full">
  <Hero slogan={data.siteContent.slogan} editMode={data.editMode} />
</div>

<!-- Page Content -->
<div class="grid md:grid-cols-3 gap-8 p-4 w-full">
  {#each cardOrder as cardName (cardName)}
    <div
      draggable={data.editMode}
      class="relative transition-opacity {dragging === cardName ? 'opacity-40' : 'opacity-100'} {dragOver === cardName && dragging !== cardName ? 'ring-2 ring-warning-500 rounded-container-token' : ''}"
      on:dragstart={(e) => handleDragStart(e, cardName)}
      on:dragover={(e) => handleDragOver(e, cardName)}
      on:drop={(e) => handleDrop(e, cardName)}
      on:dragend={handleDragEnd}
    >
      {#if data.editMode}
        <div class="absolute top-2 left-2 z-10 bg-black/60 text-white rounded p-1 cursor-grab pointer-events-none" title="Drag to reorder">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M7 2a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm6-12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0z"/>
          </svg>
        </div>
      {/if}
      {#if cardName === 'mission'}
        <MissionStatement text={data.siteContent.missionStatement} image={data.siteContent.cardImages.mission} editMode={data.editMode} />
      {:else if cardName === 'projects'}
        <Projects totalProjects={data.projectCount} text={data.siteContent.projectStatement} image={data.siteContent.cardImages.projects} editMode={data.editMode} />
      {:else if cardName === 'teaching'}
        <Teaching text={data.siteContent.teachingStatement} image={data.siteContent.cardImages.teaching} editMode={data.editMode} />
      {:else if cardName === 'outreach'}
        <Outreach text={data.siteContent.outreachStatement} image={data.siteContent.cardImages.outreach} editMode={data.editMode} />
      {:else if cardName === 'competition'}
        <Competition text={data.siteContent.competitionStatement} image={data.siteContent.cardImages.competition} editMode={data.editMode} />
      {:else if cardName === 'research'}
        <Research text={data.siteContent.researchStatement} image={data.siteContent.cardImages.research} editMode={data.editMode} />
      {/if}
    </div>
  {/each}
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
