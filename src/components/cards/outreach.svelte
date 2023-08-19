<script lang="ts">
  import config from '../../config';
</script>

<div class="card card-hover overflow-hidden">
  <img
    src="/photos/outreach.png"
    class="bg-black/50 w-full aspect-[21/9] object-cover"
    alt="Post"
  />
  <div class="p-4 space-y-4">
    <h6 class="h6">Outreach</h6>
    <article>
      <p>
        {config.information.outreachStatement}
      </p>
    </article>
  </div>
  <hr class="opacity-50" />
  <footer class="card-footer mt-2">~12 Opportunities Every Semester</footer>
</div>
