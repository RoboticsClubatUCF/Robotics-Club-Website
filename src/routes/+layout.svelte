<script lang="ts">
  import { Toast, initializeStores } from '@skeletonlabs/skeleton';
  initializeStores();
</script>

<Toast />
<svelte:head>{@html `<script>
(function(){
  var s=localStorage.getItem('modeCurrent');
  if(s!==null){document.documentElement.classList.toggle('dark',s==='false');}
  else{document.documentElement.classList.add('dark');}
})();
</script>`}</svelte:head>
<slot />
