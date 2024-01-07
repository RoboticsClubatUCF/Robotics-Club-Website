<script lang="ts">
  import { type PayPalNamespace, loadScript } from '@paypal/paypal-js';
  import { onMount } from 'svelte';
  import PAYPAL_API_KEY from '../../paypal';

  let paypal: PayPalNamespace | null;
  onMount(async () => {
    try {
      paypal = await loadScript({
        clientId: PAYPAL_API_KEY.API_KEY,
        components: 'buttons,marks,messages',
        dataPageType: 'checkout',

        currency: 'USD'
      });
      if (paypal != null) {
        try {
          let element = document.getElementById('paypalButtonsYear');
          //@ts-ignore
          let buttons = paypal
            .Buttons({
              createOrder: function (data, actions) {
                return actions.order.create({
                  purchase_units: [
                    {
                      description: 'Dues for One Year of RCCF',
                      amount: {
                        currency_code: 'USD',
                        value: config.paypal.year_cost
                      }
                    }
                  ]
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

<div id="paypalButtonsYear" />
