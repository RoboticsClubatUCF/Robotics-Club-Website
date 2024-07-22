<script lang="ts">
  import config from '../../config';
  import Image from 'svimg';
</script>

<div class="card card-hover overflow-hidden">
  <Image
    src="/photos/research.png"
    class="bg-black/50 w-full aspect-[21/9] object-cover"
    alt="Post"
  />
  <div class="p-4 space-y-4">
    <h6 class="h4">Research</h6>
    <article>
      <p>
        {config.information.researchStatement}
      </p>
    </article>
  </div>
  <hr class="opacity-50" />
  <footer class="card-footer mt-2">2 Research Opportunities</footer>
</div>
