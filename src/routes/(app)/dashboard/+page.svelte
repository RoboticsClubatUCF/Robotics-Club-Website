<script lang="ts">
  import { modeCurrent } from '@skeletonlabs/skeleton';
  import type { PageServerData } from './$types';
  import OneSemesterPayment from '../../../components/paypal/oneSemesterPayment.svelte';
  import { superForm } from 'sveltekit-superforms/client';
  import { onMount } from 'svelte';

  export let data: PageServerData;
  let email = data.user!.email;
  const { form, errors, constraints } = superForm(data.form, {
    clearOnSubmit: 'errors-and-message'
  });
  let paymentSuccess = false;
  $: if (paymentSuccess) {
    document.getElementById('submitPaypal')?.click();
  }
</script>

<div
  class="h-screen grid place-items-center absolute w-screen top-0 pointer-events-none overflow-scroll"
>
  <div
    class={$modeCurrent
      ? 'block card p-8 pointer-events-auto shadow-xl shadow-surface-300 sm:w-screen md:w-1/3 justify-center'
      : 'block card p-8 pointer-events-auto shadow-xl shadow-surface-500 sm:w-screen md:w-1/3 justify-center'}
  >
    <div class="p-2 rounded-md">
      <h2 class="h2">Hello {data.user?.firstName},</h2>
      <br />
      {#if (data.user?.membershipExpDate.getTime() ?? 0) < new Date().getTime()}
        <h6 class="badge variant-filled-error">Looks like your dues are Expired!</h6>
        <hr />
        <br class="h-5" />
        <OneSemesterPayment user={data.user} bind:purchaseSuccess={paymentSuccess} />
        <form method="post">
          <input type="hidden" name="email" id="email" bind:value={email} />
          <button style="visibility: hidden;" type="submit" id="submitPaypal" />
        </form>
      {:else}
        <h6 class="badge variant-filled-success">
          Your Dues expire on {data.user?.membershipExpDate}
        </h6>
        <h6 class="h6">
          Looks like you're all set! check back in on discord in about a day after paying dues for
          membership status, and look out for announcements about updates to this site!
        </h6>
      {/if}
    </div>
  </div>
</div>
