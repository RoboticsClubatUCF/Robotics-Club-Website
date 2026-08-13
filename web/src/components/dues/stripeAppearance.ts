import type { Appearance } from '@stripe/stripe-js'

/**
 * The theme for Stripe's payment form.
 *
 * This is the one place in `components/` where colour is written as a literal,
 * and it is the same exception `server/src/emails.ts` gets for the same reason:
 * the thing being styled is not on this page. Stripe's Elements render inside
 * an iframe served from stripe.com, which cannot see `index.css`, cannot
 * inherit a custom property, and takes only the values handed to it through
 * this object.
 *
 * So these are copies, and they have to be kept in step with the `rccf` theme
 * block in `src/index.css` by hand. If a value here looks wrong against the
 * rest of the page, that file is the original.
 *
 * `theme: 'night'` is the starting point rather than `'stripe'` because the
 * defaults it brings for everything not named below — placeholder text, the
 * card brand icons, the tab strip — are dark ones. Starting from the light
 * theme and overriding the dozen colours back leaves a white flash on load and
 * an icon set nobody notices is wrong until it ships.
 */
export const stripeAppearance: Appearance = {
  theme: 'night',
  variables: {
    // --color-primary: UCF gold, the site's only accent.
    colorPrimary: '#ffc904',
    // --color-base-200, the surface every panel on the site sits on.
    colorBackground: '#101010',
    colorText: '#ffffff',
    // --color-dim and --color-faint, flattened: Stripe's variables do not take
    // an alpha against a background it does not know.
    colorTextSecondary: '#9d9d9d',
    colorTextPlaceholder: '#717171',
    // --color-error.
    colorDanger: '#f2604a',
    fontFamily: '"Space Grotesk Variable", system-ui, sans-serif',
    // Hard edges. 2px reads as "cut" rather than "rounded", which is the whole
    // geometry of this site — a 6px radius here is the tell that the payment
    // form was bolted on.
    borderRadius: '2px',
    spacingUnit: '4px',
  },
  rules: {
    '.Input': {
      // --color-rule, the site's one hairline.
      border: '1px solid rgba(255, 255, 255, 0.1)',
      boxShadow: 'none',
    },
    '.Input:focus': {
      border: '1px solid #ffc904',
      boxShadow: 'none',
      outline: 'none',
    },
    '.Label': {
      // Matches `labelClass` in `components/shared/formChrome.tsx`: mono,
      // small, wide-tracked. It is the label style used by every other field
      // the member has filled in to get here.
      fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
      fontSize: '10px',
      fontWeight: '500',
      letterSpacing: '0.16em',
      textTransform: 'uppercase',
      color: '#9d9d9d',
    },
    '.Tab': {
      border: '1px solid rgba(255, 255, 255, 0.1)',
      boxShadow: 'none',
    },
    '.Tab--selected': {
      border: '1px solid #ffc904',
      boxShadow: 'none',
    },
  },
}
