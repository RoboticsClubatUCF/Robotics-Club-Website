<script lang="ts">
  import { RadioGroup, TabAnchor } from '@skeletonlabs/skeleton';
  import { page } from '$app/stores';
</script>

<RadioGroup active="variant-filled-primary" hover="hover:variant-soft-primary">
  <TabAnchor href="/" selected={$page.url.pathname === '/'}>
    <span class="capitalize">home</span>
  </TabAnchor>
  <TabAnchor href="/about" selected={$page.url.pathname === '/about'}>
    <span class="capitalize">about</span>
  </TabAnchor>
  <TabAnchor href="/projects" selected={$page.url.pathname === '/projects'}>
    <span class="capitalize">projects</span>
  </TabAnchor>
  <TabAnchor href="/history" selected={$page.url.pathname === '/history'}>
    <span class="capitalize">history</span>
  </TabAnchor>
</RadioGroup>
