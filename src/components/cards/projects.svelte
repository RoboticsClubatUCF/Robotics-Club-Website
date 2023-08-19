<script lang="ts">
  import config from '../../config';
  export let totalProjects: number;
</script>

<div class="card card-hover overflow-hidden">
  <img
    src="/photos/projects.png"
    class="bg-black/50 w-full aspect-[21/9] object-cover"
    alt="Post"
  />
  <div class="p-4 space-y-4">
    <h6 class="h6">Projects</h6>
    <article>
      <p>
        {config.information.projectStatement}
      </p>
    </article>
  </div>
  <hr class="opacity-50" />
  <footer class="card-footer mt-2">{totalProjects} Projects Completed</footer>
</div>
