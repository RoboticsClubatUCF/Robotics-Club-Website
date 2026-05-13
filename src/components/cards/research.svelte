<script lang="ts">
  import EditableText from '../EditableText.svelte';
  import EditableImage from '../EditableImage.svelte';
  export let text: string;
  export let image: string;
  export let editMode: boolean = false;
</script>

<div class="card overflow-hidden">
  <EditableImage
    contentKey="home.card.research.image"
    value={image}
    alt="Research"
    imgClass="bg-black/50 w-full aspect-[21/9] object-cover"
    {editMode}
  />
  <div class="p-4 space-y-4">
    <h6 class="h4">Research</h6>
    <article>
      <div>
        <EditableText contentKey="home.researchStatement" value={text} {editMode} />
      </div>
    </article>
  </div>
  <hr class="opacity-50" />
  <footer class="card-footer mt-2">2 Research Opportunities</footer>
</div>
