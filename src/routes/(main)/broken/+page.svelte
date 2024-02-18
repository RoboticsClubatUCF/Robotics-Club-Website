<script lang="ts">
  import type { PageData } from './$types';
  export let data: PageData;
</script>

<div class="card m-4 p-4">
  <h2 class="h2">Hey!</h2>
  <h4 class="h4">About that page you were trying to open. . . .</h4>
  <p>
    Well, story short, its not done, and it'll get done eventually, just not right now, so instead
    enjoy this picture of a doggy
  </p>
  <br />
  <img class="rounded-lg" src={data.dog} alt="" />
  <br />
  <a class="btn variant-ghost-primary hover:variant-filled-primary" href="/">Go Back Home</a>
</div>
