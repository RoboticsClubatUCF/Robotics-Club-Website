<script lang="ts">
  import type { PageData } from './$types';
  import EditableText from '../../../components/EditableText.svelte';
  import Admins from '../../../components/cards/admins.svelte';
  export let data: PageData;
  export let params: Record<string, string>;
</script>

<div class="w-screen flex">
  <div class="centered h1 animate mt-4">
    <EditableText
      contentKey="about.pageTitle"
      value={data.siteContent.pageTitle}
      editMode={data.editMode}
      multiline={false}
    />
  </div>
</div>

<div class="p-8">
  <Admins officers={data.officers} editMode={data.editMode} />
</div>

<div class="w-screen flex">
  <div class="centered h1 animate mt-6">
    <EditableText
      contentKey="about.section.frq"
      value={data.siteContent.frqSection}
      editMode={data.editMode}
      multiline={false}
    />
  </div>
</div>

<div class="w-screen flex">
  <div class="centered h1 animate mt-6">
    <EditableText
      contentKey="about.section.constitution"
      value={data.siteContent.constitutionSection}
      editMode={data.editMode}
      multiline={false}
    />
  </div>
</div>

<div class="w-screen flex mb-8">
  <div class="centered h1 animate mt-6">
    <EditableText
      contentKey="about.section.taxInfo"
      value={data.siteContent.taxInfoSection}
      editMode={data.editMode}
      multiline={false}
    />
  </div>
</div>
