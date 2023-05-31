<script>
  const social = [
    {
      link: '/',
      name: 'social' + Math.floor(Math.random() * 100).toString()
    },
    {
      link: '/',
      name: 'social' + Math.floor(Math.random() * 100).toString()
    },
    {
      link: '/',
      name: 'social' + Math.floor(Math.random() * 100).toString()
    },
    {
      link: '/',
      name: 'social' + Math.floor(Math.random() * 100).toString()
    },
    {
      link: '/',
      name: 'social' + Math.floor(Math.random() * 100).toString()
    },
    {
      link: '/',
      name: 'social' + Math.floor(Math.random() * 100).toString()
    },
    {
      link: '/',
      name: 'social' + Math.floor(Math.random() * 100).toString()
    },
    {
      link: '/',
      name: 'social' + Math.floor(Math.random() * 100).toString()
    },
    {
      link: '/',
      name: 'social' + Math.floor(Math.random() * 100).toString()
    },
    {
      link: '/',
      name: 'social' + Math.floor(Math.random() * 100).toString()
    },
    {
      link: '/',
      name: 'social' + Math.floor(Math.random() * 100).toString()
    },
    {
      link: '/',
      name: 'social' + Math.floor(Math.random() * 100).toString()
    },
    {
      link: '/',
      name: 'social' + Math.floor(Math.random() * 100).toString()
    },
    {
      link: '/',
      name: 'social' + Math.floor(Math.random() * 100).toString()
    },
    {
      link: '/',
      name: 'social' + Math.floor(Math.random() * 100).toString()
    },
    {
      link: '/',
      name: 'social' + Math.floor(Math.random() * 100).toString()
    },
    {
      link: '/',
      name: 'social' + Math.floor(Math.random() * 100).toString()
    },
    {
      link: '/',
      name: 'social' + Math.floor(Math.random() * 100).toString()
    },
    {
      link: '/',
      name: 'social' + Math.floor(Math.random() * 100).toString()
    },
    {
      link: '/',
      name: 'social' + Math.floor(Math.random() * 100).toString()
    },
    {
      link: '/',
      name: 'social' + Math.floor(Math.random() * 100).toString()
    },
    {
      link: '/',
      name: 'social' + Math.floor(Math.random() * 100).toString()
    },
    {
      link: '/',
      name: 'social' + Math.floor(Math.random() * 100).toString()
    },
    {
      link: '/',
      name: 'social' + Math.floor(Math.random() * 100).toString()
    }
  ];
</script>

<!-- html -->
<div class="logo-cloud grid-cols-1 lg:!grid-cols-7 gap-1 variant-filled-surface">
  {#each social as socialLink}
    <a class="logo-item variant-filled-primary" href={socialLink.link}>
      <span class="h1">{socialLink.name}</span>
    </a>
  {/each}
</div>

<style></style>
