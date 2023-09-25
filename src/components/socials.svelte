<script lang="ts">
  export let socials: {
    name: String;
    logo: String;
  }[];
</script>

<div class="logo-cloud grid-cols-1 xl:grid-cols-2 2xl:grid-cols-4 gap-0.5">
  {#each socials as s}
    <a href="/elements/logo-clouds" class="logo-item">{s.name}</a>
  {/each}
</div>
