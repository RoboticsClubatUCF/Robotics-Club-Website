<script lang="ts">
  import EditableText from '../EditableText.svelte';
  import EditableImage from '../EditableImage.svelte';
  export let totalProjects: number;
  export let text: string;
  export let image: string;
  export let editMode: boolean = false;
</script>

<div class="card overflow-hidden">
  <EditableImage
    contentKey="home.card.projects.image"
    value={image}
    alt="Projects"
    imgClass="bg-black/50 w-full aspect-[21/9] object-cover"
    {editMode}
  />
  <div class="p-4 space-y-4">
    <h6 class="h4">Projects</h6>
    <article>
      <p>
        <EditableText contentKey="home.projectStatement" value={text} {editMode} />
      </p>
    </article>
  </div>
  <hr class="opacity-50" />
  <footer class="card-footer mt-2">{totalProjects} Projects Completed</footer>
</div>
