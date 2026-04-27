<script lang="ts">
  import config from '../../config';
</script>

<div class="card overflow-hidden">
  <img
    src="/photos/competition.png"
    class="bg-black/50 w-full aspect-[21/9] object-cover object-bottom"
    alt="Competition"
  />
  <div class="p-4 space-y-4">
    <h6 class="h4">Competition</h6>
    <article>
      <p>
        {config.information.competitionStatement}
      </p>
    </article>
  </div>
  <hr class="opacity-50" />
  <footer class="card-footer mt-2">2 Competitions a Year</footer>
</div>
