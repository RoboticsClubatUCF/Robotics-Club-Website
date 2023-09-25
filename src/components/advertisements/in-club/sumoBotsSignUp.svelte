<script>
  import { modeCurrent } from '@skeletonlabs/skeleton';
</script>

<div
  class={$modeCurrent
    ? 'block card p-8 pointer-events-auto shadow-xl shadow-surface-300 sm:w-screen md:w-5/6 justify-center card-hover'
    : 'block card p-8 pointer-events-auto shadow-xl shadow-surface-500 sm:w-screen md:w-5/6 justify-center card-hover'}
>
  <div class="p-2 rounded-md">
    <h2 class="h2">Sumo Bots!</h2>
    <br />
    <div>
      <!-- PRINT TEAM INFO HERE -->
      <!-- IF USER IS NOT PART OF A SUMO BOTS TEAM, GIVE THEM THE BUTTON BELOW -->
    </div>
    <a
      href="./dashboard/registerTeam"
      class="btn variant-ghost-secondary hover:variant-filled-secondary capitalize">Register team</a
    >
  </div>
</div>
