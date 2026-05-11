<script lang="ts">
  import EditableText from '../EditableText.svelte';
  import EditableImage from '../EditableImage.svelte';
  export let text: string;
  export let image: string;
  export let editMode: boolean = false;
</script>

<div class="card overflow-hidden">
  <EditableImage
    contentKey="home.card.mission.image"
    value={image}
    alt="Mission Statement"
    imgClass="bg-black/50 w-full aspect-[21/9] object-cover"
    {editMode}
  />
  <div class="p-4 space-y-4">
    <h6 class="h4">Mission</h6>
    <article>
      <p>
        <EditableText contentKey="home.missionStatement" value={text} {editMode} />
      </p>
    </article>
  </div>
  <hr class="opacity-50" />
  <footer class="card-footer mt-2">Est 1972</footer>
</div>
