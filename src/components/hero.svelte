<script lang="ts">
  import config from '../config';
</script>

<div class="w-screen flex">
  <div class="centered h1">
    {config.information.slogan}
  </div>
</div>

<style>
  .centered {
    max-width: 100vw; /* Can be in percentage also. */
    height: auto;
    margin: 0 auto;
    margin-top: 5rem;
    padding: 10px;
    position: relative;
    text-align: center;
  }
</style>
