<script lang="ts">
  import { goto } from '$app/navigation';
  import { loadStripe, type Stripe } from '@stripe/stripe-js';
  import { PUBLIC_STRIPE_KEY } from '$env/static/public';
  import { Address, Elements, LinkAuthenticationElement, PaymentElement } from 'svelte-stripe';
  import config from '../../config';
  import { onMount } from 'svelte';
  let stripe: Stripe | null = null;
  let clientSecret: null = null;
  let error: any | null = null;
  let elements: any;
  let processing = false;
  export let userID: string;
  let thm: 'night' | 'stripe' | 'flat' | undefined = 'night';
  let duesSelection = '';
  let hide: boolean = false;

  const appearance = {
    theme: thm,
    variables: {},
    rules: {}
  };
  onMount(async () => {
    stripe = await loadStripe(PUBLIC_STRIPE_KEY);

    // clientSecret = await createPayment();
  });

  async function createPayment() {

    const response = await fetch('/create-payment-intent', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ duesType: duesSelection })
    });
    const { clientSecret } = await response.json();

    return clientSecret;
  }

  async function submit() {
    // avoid processing duplicates
    if (processing) return;

    processing = true;

    // confirm payment with stripe
    if (stripe) {
      const result = await stripe.confirmPayment({
        elements,
        redirect: 'if_required'
      });

      if (result.error) {
        // payment failed, notify user
        error = result.error;
        processing = false;
      } else {
        // payment succeeded, redirect to "thank you" page
        goto('/thankyou/' + userID);
      }
    }
  }

  function reloadPage(){
    location.reload();
  }

  async function test(){
    // create payment intent server side
    clientSecret = await createPayment();
    hide = true;
  }
</script>

{#if error}
  <h4 class="h4">Please try again</h4>
  <p class="badge variant-filled-error">{error.message}</p>
{/if}

{#if !hide}
<label class="label">
  <span>Pay Dues For The Semester or Year</span>
  <select class="select" bind:value={duesSelection} on:change={test}>
    <option value='1'>Semester: $25</option>
    <option value='2'>Year: $50</option>
  </select>
</label>
{:else}
  {#if duesSelection == '1'}
    <span>Semesterly Dues</span>
    <button on:click={reloadPage} class="btn variant-ghost-tertiary hover:variant-filled-tertiary">Cancel</button>

  {/if}
  {#if duesSelection == '2'}
    <span>Yearly Dues</span>
    <button on:click={reloadPage} class="btn variant-ghost-tertiary hover:variant-filled-tertiary">Cancel</button>

  {/if}
{/if}

{#if duesSelection}
  {#if clientSecret && stripe}
    <Elements
      {stripe}
      {clientSecret}
      theme={appearance.theme}
      labels="floating"
      variables={appearance.variables}
      rules={appearance.rules}
      bind:elements
    >
      <form on:submit|preventDefault={submit}>
        <LinkAuthenticationElement />
        <PaymentElement />
        <Address mode="billing" />

        <button class="btn variant-ghost-surface btn-xl" disabled={processing}>
          {#if processing}
            Processing...
          {:else}
            {#if duesSelection === '1'}
            Pay ${config.paypal.semester_cost}
            {/if}
            {#if duesSelection === '2'}
            Pay ${config.paypal.year_cost}
            {/if}
          {/if}
        </button>
      </form>
    </Elements>
  {:else}
    Loading...
  {/if}
{/if}

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 2rem 0;
  }
</style>
