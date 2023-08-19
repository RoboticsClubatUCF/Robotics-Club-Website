<script lang="ts">
  import config from '../../config';
</script>

<a class="card card-hover overflow-hidden" href="/#mission">
  <img
    src="/photos/mission_statement.png"
    class="bg-black/50 w-full aspect-[21/9] object-cover"
    alt="Post"
  />
  <div class="p-4 space-y-4">
    <h6 class="h6">Mission</h6>
    <article>
      <p>
        {config.information.missionStatement}
      </p>
    </article>
  </div>
  <hr class="opacity-50" />
  <footer class="card-footer mt-2">Est 1972</footer>
</a>
