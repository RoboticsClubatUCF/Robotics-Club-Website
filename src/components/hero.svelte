<script lang="ts">
  import config from '../config';
</script>

<div class="w-screen flex">
  <div class="centered h1 animate">
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
    margin-bottom: 5rem;
    position: relative;
    text-align: center;
    animation: fadeIn 3s;
  }
  @keyframes fadeIn {
    0% {
      opacity: 0;
    }
    100% {
      opacity: 1;
    }
  }
</style>
