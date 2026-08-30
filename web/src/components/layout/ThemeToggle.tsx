import { DARK, LIGHT, setTheme, useTheme } from '../../lib/theme'

/**
 * The light/dark switch.
 *
 * **One button, two states, and it says what it will do rather than what it
 * is.** A toggle drawn as "you are in dark mode" and a toggle drawn as "press
 * for light mode" look identical and mean opposite things, and every visitor
 * reads the icon as the second one — so that is what it is: the sun means "make
 * it light", and the accessible name says so in words.
 *
 * No `aria-pressed`. That would announce it as a checkbox with a state, which
 * puts the reader back in the ambiguity above; a button whose name changes is
 * unambiguous in both directions.
 *
 * There is no third state for "follow the system". Everybody starts in it —
 * `lib/theme.ts` has the argument — and a control that most people would never
 * press, explaining a state they are already in, is a worse bar than a missing
 * one.
 *
 * It lives in the footer, at the far right of the last row on the page —
 * `SiteFooter` has the argument for why it is not in the nav.
 *
 * Drawn rather than imported, the same call `MenuIcon` makes in the nav: an
 * icon package for two glyphs is a dependency for two glyphs.
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const theme = useTheme()
  const next = theme === LIGHT ? DARK : LIGHT

  return (
    <button
      type="button"
      onClick={() => {
        setTheme(next)
      }}
      /* The words a screen reader gets, and the tooltip a pointer gets. Both
         name the destination — "Switch to dark theme" — because that is the
         only reading of this control that is never wrong. */
      aria-label={next === LIGHT ? 'Switch to light theme' : 'Switch to dark theme'}
      title={next === LIGHT ? 'Switch to light theme' : 'Switch to dark theme'}
      className={`border-rule text-dim hover:border-primary hover:text-primary focus-visible:outline-primary flex shrink-0 cursor-pointer items-center justify-center border transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 ${className}`}
    >
      {/* The icon shows the theme being asked for, not the one in force. */}
      {next === LIGHT ? <SunIcon /> : <MoonIcon />}
    </button>
  )
}

/**
 * A disc and eight rays. `currentColor` throughout, so it inherits the hover
 * state off the button rather than carrying a colour of its own — which is the
 * same rule the rest of the site follows: a component is not where a colour
 * gets invented.
 */
function SunIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      className="size-4.5"
    >
      <circle cx="12" cy="12" r="4.2" />
      {/* Generated rather than written out eight times: the only thing that
          differs between the rays is the angle, and eight near-identical lines
          are eight chances to mistype one. */}
      {Array.from({ length: 8 }, (_, index) => (
        <line
          key={index}
          x1="12"
          y1="1.8"
          x2="12"
          y2="4.2"
          transform={`rotate(${String(index * 45)} 12 12)`}
        />
      ))}
    </svg>
  )
}

/**
 * A crescent, cut as one path rather than as two overlapping circles — the
 * button sits on a translucent, blurred bar, and a "moon" made by covering a
 * disc with a page-coloured one shows the bar straight through the bite.
 */
function MoonIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4.5"
    >
      <path d="M20 14.2A8.5 8.5 0 0 1 9.8 4a8.5 8.5 0 1 0 10.2 10.2Z" />
    </svg>
  )
}
