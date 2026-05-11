<svelte:head>
  <title>Outreach @ RCCF</title>
</svelte:head>

<script lang="ts">
  import type { PageData } from './$types';
  import EditableText from '../../../components/EditableText.svelte';
  import EditableImage from '../../../components/EditableImage.svelte';
  export let data: PageData;
</script>

<div class="p-4 m-4">
  <!-- Hero Section -->
  <div class="mt-6 justify-center flex">
    <h2 class="h1">
      <EditableText
        contentKey="outreach.hero"
        value={data.siteContent.hero}
        editMode={data.editMode}
        multiline={false}
      />
    </h2>
  </div>
  <br />

  <div class="content-section">
    <div class="text-container">
      <p class="text-lg">
        <EditableText
          contentKey="outreach.intro.text"
          value={data.siteContent.introText}
          editMode={data.editMode}
        />
      </p>
    </div>
    <div class="image-container">
      <EditableImage
        contentKey="outreach.intro.image"
        value={data.siteContent.introImage}
        alt="Outreach Image"
        editMode={data.editMode}
        imgClass="w-full rounded"
      />
    </div>
  </div>

  <!-- Commitment Section -->
  <br />
  <hr />
  <div>
    <div class="mt-6 justify-center flex">
      <h1 class="h1">
        <EditableText
          contentKey="outreach.commitment.title"
          value={data.siteContent.commitmentTitle}
          editMode={data.editMode}
          multiline={false}
        />
      </h1>
    </div>
    <br />
    <div class="content-section">
      <div class="image-container">
        <EditableImage
          contentKey="outreach.commitment.image"
          value={data.siteContent.commitmentImage}
          alt="Commitment Image"
          editMode={data.editMode}
          imgClass="w-full rounded"
        />
      </div>
      <div class="text-container">
        <p class="text-lg">
          <EditableText
            contentKey="outreach.commitment.text"
            value={data.siteContent.commitmentText}
            editMode={data.editMode}
          />
        </p>
      </div>
    </div>

    <br />
    <hr />

    <div class="mt-6 justify-center flex">
      <h1 class="h2">
        <EditableText
          contentKey="outreach.hostUs.title"
          value={data.siteContent.hostUsTitle}
          editMode={data.editMode}
          multiline={false}
        />
      </h1>
    </div>
    <br />
    <div class="flex-1 text-center">
      <p class="text-lg">
        <EditableText
          contentKey="outreach.hostUs.text"
          value={data.siteContent.hostUsText}
          editMode={data.editMode}
        />
      </p>
      {#if data.editMode}
        <div class="mt-2">
          <p class="text-xs opacity-60 mb-1">Contact email address:</p>
          <EditableText
            contentKey="outreach.hostUs.email"
            value={data.siteContent.hostUsEmail}
            editMode={data.editMode}
            multiline={false}
          />
        </div>
      {:else}
        <a href="mailto:{data.siteContent.hostUsEmail}" class="text-blue-500 underline">
          {data.siteContent.hostUsEmail}
        </a>
      {/if}
    </div>
  </div>
  <br />
  <br />
</div>
