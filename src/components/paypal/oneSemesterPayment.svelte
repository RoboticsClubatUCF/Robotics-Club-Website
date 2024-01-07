<script lang="ts">
  import { type PayPalNamespace, loadScript } from '@paypal/paypal-js';
  import { onMount } from 'svelte';
  import config from '../../config';
  import PAYPAL_API_KEY from '../../paypal';
  export let purchaseSuccess = false;

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
          let element = document.getElementById('paypalButtonsSemester');
          //@ts-ignore
          let buttons = paypal
            .Buttons({
              createOrder: function (data, actions) {
                return actions.order.create({
                  purchase_units: [
                    {
                      description: 'Dues for One Semester of RCCF',
                      amount: {
                        currency_code: 'USD',
                        value: config.paypal.semester_cost
                      }
                    }
                  ]
                });
              },
              onApprove: function (data, actions) {
                return actions.order!.capture().then((details) => {
                  purchaseSuccess = true;
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

<div id="paypalButtonsSemester" />
