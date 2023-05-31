<script lang="ts">
  import { superForm } from 'sveltekit-superforms/client';
  import type { PageData } from './$types';

  export let data: PageData;
  const { form, errors, constraints } = superForm(data.form);
</script>

<div class="h-screen grid place-items-center absolute w-screen top-0 pointer-events-none">
  <div class="block card p-4 m-8 pointer-events-auto">
    <form action="POST">
      <label class="label">
        <span>First Name</span>
        <input type="text" name="name" id="name" bind:value={$form} />
      </label>
    </form>
  </div>
</div>
