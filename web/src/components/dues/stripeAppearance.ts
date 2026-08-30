import type { Appearance } from '@stripe/stripe-js'
import { LIGHT, type Theme } from '../../lib/theme'

/**
 * The theme for Stripe's payment form.
 *
 * This is the one place in `components/` where colour is written as a literal,
 * and it is the same exception `server/src/email/emails.ts` gets for the same reason:
 * the thing being styled is not on this page. Stripe's Elements render inside
 * an iframe served from stripe.com, which cannot see `index.css`, cannot
 * inherit a custom property, and takes only the values handed to it through
 * this object.
 *
 * So these are copies, and they have to be kept in step with the two theme
 * blocks in `src/index.css` by hand. If a value here looks wrong against the
 * rest of the page, that file is the original.
 *
 * **Two themes means two of everything, including Stripe's own base.**
 * `theme: 'night'` is the dark starting point rather than `'stripe'` because
 * the defaults it brings for everything *not* named below — placeholder text,
 * the card brand icons, the tab strip — are dark ones; starting from the light
 * base and overriding the dozen colours back leaves a white flash on load and
 * an icon set nobody notices is wrong until it ships. In light mode that
 * argument runs the other way round, so light mode starts from `'stripe'`.
 *
 * **The form does not restyle itself when the theme changes mid-payment, and
 * that is deliberate.** `Elements` takes its appearance when it mounts and
 * `PaymentForm` keys the tree on the client secret; re-keying it on the theme
 * as well would tear down a mounted card field — losing whatever has been typed
 * into it — because somebody pressed a switch in the nav. Somebody who changes
 * theme with a payment open gets the form they opened, and the next one is in
 * the theme they chose.
 */

/** The gold, per theme: bright on near-black, and the deep ochre on off-white.
    Both are `--color-primary` in their block. */
const accent = { dark: '#ffc904', light: '#8a6a00' } as const

/**
 * `--color-dim` and `--color-faint`, flattened against `--color-base-200`.
 * Stripe's variables take no alpha — it would be an alpha against a background
 * the other document does not know about — which is the same reason
 * `emails.ts` flattens the same two tiers.
 */
const secondaryText = { dark: '#9d9d9d', light: '#5f5e5a' } as const
const placeholderText = { dark: '#717171', light: '#7d7c78' } as const

/** `--color-rule`, flattened the same way. */
const hairline = { dark: 'rgba(255, 255, 255, 0.1)', light: 'rgba(20, 19, 15, 0.14)' } as const

/**
 * The appearance for one theme.
 *
 * A function rather than two exported objects, because everything except the
 * five colours above and Stripe's base name is identical between them — and two
 * near-identical eighty-line literals is how one of them ends up with a 6px
 * radius nobody notices.
 */
export function stripeAppearanceFor(theme: Theme): Appearance {
  const light = theme === LIGHT
  const pick = <T,>(pair: { dark: T; light: T }): T => (light ? pair.light : pair.dark)

  return {
    theme: light ? 'stripe' : 'night',
    variables: {
      // --color-primary: the site's only accent.
      colorPrimary: pick(accent),
      // --color-base-200, the surface every panel on the site sits on.
      colorBackground: light ? '#f4f2ee' : '#101010',
      // --color-base-content.
      colorText: light ? '#14130f' : '#ffffff',
      colorTextSecondary: pick(secondaryText),
      colorTextPlaceholder: pick(placeholderText),
      // --color-error.
      colorDanger: light ? '#bc3520' : '#f2604a',
      fontFamily: '"Space Grotesk Variable", system-ui, sans-serif',
      // Hard edges. 2px reads as "cut" rather than "rounded", which is the whole
      // geometry of this site — a 6px radius here is the tell that the payment
      // form was bolted on. Not a themed value: `index.css` says geometry is not
      // a theme, and the two blocks there carry the same radii.
      borderRadius: '2px',
      spacingUnit: '4px',
    },
    rules: {
      '.Input': {
        // --color-rule, the site's one hairline.
        border: `1px solid ${pick(hairline)}`,
        boxShadow: 'none',
      },
      '.Input:focus': {
        border: `1px solid ${pick(accent)}`,
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
        color: pick(secondaryText),
      },
      '.Tab': {
        border: `1px solid ${pick(hairline)}`,
        boxShadow: 'none',
      },
      '.Tab--selected': {
        border: `1px solid ${pick(accent)}`,
        boxShadow: 'none',
      },
    },
  }
}
