<script lang="ts">
  import { page } from '$app/stores';

  $: path = $page.route.id?.slice(7).split('/');
</script>

<ol class="breadcrumb">
  {#if path != undefined}
    {#each path as crumb, i}
      <!-- If crumb index is less than the breadcrumb length minus 1 -->
      {#if i < path.length - 1}
        <li class="crumb"><a class="anchor" href="/{crumb}">{crumb}</a></li>
        <li class="crumb-separator" aria-hidden>&rsaquo;</li>
      {:else}
        <li class="crumb">{crumb}</li>
      {/if}
    {/each}
  {/if}
</ol>
