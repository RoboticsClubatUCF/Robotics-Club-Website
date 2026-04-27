<script lang="ts">
  import EditableText from './EditableText.svelte';
  export let slogan: string;
  export let editMode: boolean = false;
</script>

<div class="w-screen flex">
  <div class="centered h1 animate mt-20 mb-20 p-[10px]">
    <EditableText contentKey="home.slogan" value={slogan} {editMode} multiline={false} />
  </div>
</div>
