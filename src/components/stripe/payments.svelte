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
  let duesSelection = '1';

  const appearance = {
    theme: thm,
    variables: {},
    rules: {}
  };
  onMount(async () => {
    stripe = await loadStripe(PUBLIC_STRIPE_KEY);

    // create payment intent server side
    clientSecret = await createPayment();
  });

  async function createPayment() {
    const response = await fetch('/create-payment-intent', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({})
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
</script>

<!-- <label class="label">
  <span>Select Yearly or Semesterly Dues</span>
  <select class="select" bind:value={duesSelection}>
    <option value="1">1 Year</option>
    <option value="2">1 Semester</option>
  </select>
</label> -->
{#if error}
  <h4 class="h4">Please try again</h4>
  <p class="badge variant-filled-error">{error.message}</p>
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
            Pay ${config.paypal.semester_cost}
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
