<script lang="ts">
  import { RadioGroup, TabAnchor } from '@skeletonlabs/skeleton';
  import { page } from '$app/stores';
</script>

<!-- Desktop navigation (hidden on small screens) -->
<div class="site-navigation hidden sm:block">
  <RadioGroup active="variant-filled-primary" hover="hover:variant-ghost-primary">
    <TabAnchor href="/" selected={$page.url.pathname === '/'}>
      <span class="capitalize">home</span>
    </TabAnchor>
    <TabAnchor href="/projects" selected={$page.url.pathname === '/projects'}>
      <span class="capitalize">projects</span>
    </TabAnchor>
    <TabAnchor href="/sponsors" selected={$page.url.pathname === '/sponsors'}>
      <span class="capitalize">sponsors</span>
    </TabAnchor>
    <TabAnchor href="/outreach" selected={$page.url.pathname === '/outreach'}>
      <span class="capitalize">outreach</span>
    </TabAnchor>
    <TabAnchor href="http://secretlibrary.rccf.club" target="_blank" selected={false}>
      <span class="capitalize">library</span>
    </TabAnchor>
  </RadioGroup>
</div>
