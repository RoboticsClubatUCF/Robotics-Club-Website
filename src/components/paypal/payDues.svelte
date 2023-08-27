<script lang="ts">
  import { type PayPalNamespace, loadScript } from '@paypal/paypal-js';
  import { onMount } from 'svelte';
  import config from '../../config';

  let duesSelection = '1';
  export let purchaseSuccess = {
    success: false,
    duesType: Number(duesSelection)
  };

  let paypal: PayPalNamespace | null;

  let duesCost = () => {
    if (duesSelection == '1') {
      return config.paypal.semester_cost;
    }
    return config.paypal.year_cost;
  };

  onMount(async () => {
    try {
      paypal = await loadScript({
        clientId: config.paypal.CLIENT_ID,
        components: 'buttons,marks,messages',
        dataPageType: 'checkout',

        currency: 'USD'
      });
      if (paypal != null) {
        try {
          let element = document.getElementById('paypalButtonsSemester');
          //@ts-ignore
          let buttons = paypal
            .Buttons({
              createOrder: function (data, actions) {
                return actions.order.create({
                  purchase_units: [
                    {
                      description: 'Dues for RCCF',
                      amount: {
                        currency_code: 'USD',
                        value: duesCost()
                      }
                    }
                  ]
                });
              },
              onApprove: function (data, actions) {
                return actions.order!.capture().then((details) => {
                  purchaseSuccess.success = true;
                });
              }
            })
            .render(element ?? '');
        } catch (error) {
          console.error('Paypal Buttons failed to draw');
          console.warn(error);
        }
      }
    } catch (err) {
      console.error('Paypal did not initialize!');
      console.warn(err);
    }
  });
</script>

<label class="label">
  <span>Dues Duration</span>
  <select class="select" bind:value={duesSelection}>
    <option value="1" selected>Semester ({config.paypal.semester_cost})</option>
    <option value="2">Year ({config.paypal.year_cost})</option>
  </select>
</label>
<br />
<div id="paypalButtonsSemester" />
