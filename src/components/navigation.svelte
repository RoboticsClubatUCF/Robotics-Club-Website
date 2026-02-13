<script lang="ts">
  import { RadioGroup, TabAnchor } from '@skeletonlabs/skeleton';
  import { page } from '$app/stores';
</script>

<RadioGroup active="variant-filled-primary" hover="hover:variant-ghost-primary">
  <TabAnchor href="/" selected={$page.url.pathname === '/'}>
    <span class="capitalize" style="">home</span>
  </TabAnchor>
  <!-- <TabAnchor href="/about" selected={$page.url.pathname === '/about'}>
    <span class="capitalize">about</span>
  </TabAnchor> -->
  <TabAnchor href="/projects" selected={$page.url.pathname === '/projects/'}>
    <span class="capitalize">projects</span>
  </TabAnchor>
  <TabAnchor href="/sponsors" selected={$page.url.pathname === '/sponsors/'}>
    <span class="capitalize">sponsors</span>
  </TabAnchor>
  <TabAnchor href="/outreach" selected={$page.url.pathname === '/outreach'}>
    <span class="capitalize">outreach</span>
  </TabAnchor>
  <TabAnchor
    href="http://secretlibrary.rccf.club"
    target="_blank"
    selected={$page.url.pathname === 'secretlibrary.rccf.club'}
  >
    <span class="capitalize">library</span>
  </TabAnchor>
</RadioGroup>

<style>
  @media (max-width: 540px) {
    .capitalize {
      font-size: .7rem !important;
      line-height: .7rem !important;
      margin-left: -10px !important
      
    }
    
  }
  @media (max-width: 350px) {
    .capitalize {
      font-size: .6rem !important;
      line-height: .6rem !important;
      margin-left: -13px !important
      
    }
  }
</style>
