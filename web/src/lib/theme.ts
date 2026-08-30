import { useSyncExternalStore } from 'react'

/**
 * Which of the two themes is on, and how that is decided.
 *
 * **The names are DaisyUI's, because the value goes straight into
 * `data-theme`.** `index.css` declares both blocks under exactly these strings;
 * a third theme means a block there and a member of this union, and nothing
 * else on the site learns about it.
 *
 * **There are two themes and three states.** Somebody who has never touched the
 * toggle is *following the system*, and keeps following it — change the OS
 * setting with the tab open and the page changes under them, which is what that
 * setting is for. Pressing the toggle is what ends that: from then on the
 * choice is theirs, it is in `localStorage`, and the system is no longer
 * consulted. There is deliberately no third button to get back to "follow the
 * system": it would be a control most people would never press, explaining a
 * state they were already in.
 *
 * **The dark theme is the fallback everywhere.** No stored choice and no
 * `matchMedia` — a very old browser, a test environment — lands on dark, which
 * is the theme the site has always had and the one `index.css` marks
 * `default: true`.
 */
export type Theme = 'rccf' | 'rccf-light'

export const DARK: Theme = 'rccf'
export const LIGHT: Theme = 'rccf-light'

/**
 * **Mirrored by hand in `index.html`, and it has to stay that way.** That
 * inline script runs before first paint and settles the theme so the page never
 * flashes the wrong one; it cannot import this module, because a module is
 * fetched and by then the paint has happened. So the key, the two names and the
 * order the two sources are consulted in exist twice. Change one, change the
 * other — `theme.test.ts` pins the pair against each other, which is the only
 * thing that can.
 */
export const STORAGE_KEY = 'rccf-theme'

const isTheme = (value: unknown): value is Theme => value === DARK || value === LIGHT

/**
 * Every read of `localStorage` here is wrapped, because it is not always there
 * to read: Safari in private browsing has historically thrown on write, and a
 * browser set to block site data throws on access rather than answering empty.
 * A theme preference is not worth a white screen.
 */
export function storedTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isTheme(stored) ? stored : null
  } catch {
    return null
  }
}

const darkQuery = () =>
  typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null

/** What the operating system is asking for, or dark where it will not say. */
export const systemTheme = (): Theme => (darkQuery()?.matches === false ? LIGHT : DARK)

/** The theme in force: the visitor's choice if they have made one, else the system's. */
export const currentTheme = (): Theme => storedTheme() ?? systemTheme()

/**
 * Put a theme on the document.
 *
 * Two things move, not one. `data-theme` is what every colour on the page hangs
 * off, and `theme-color` is what paints the browser's own chrome on a phone —
 * left alone, the address bar stays near-black over a white page, which looks
 * like the page failed to load rather than like a bar we forgot.
 *
 * `color-scheme` is deliberately *not* set here: each theme block in
 * `index.css` declares its own, so the scrollbars and form controls follow the
 * attribute along with everything else.
 *
 * The two hexes are `--color-base-100` from those blocks, copied. They are the
 * third copy of that pair on the site — the others are `index.html`, which
 * paints the bar before this module exists, and `stripeAppearance.ts`, which
 * hands colours to another origin. All three are hand-kept for the same reason:
 * the value has to be available somewhere the stylesheet is not. `index.css` is
 * the original of all of them. Reading the computed property off the element
 * instead was tried and gives nothing under a test runner that does not process
 * CSS, which trades a documented copy for a silent empty string.
 */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme

  const meta = document.querySelector('meta[name="theme-color"]')
  meta?.setAttribute('content', theme === LIGHT ? '#fbfaf8' : '#0b0b0b')
}

/**
 * Subscribers, so anything drawing the theme is redrawn when it changes.
 *
 * **The switch is not the only thing that changes the theme, which is why this
 * exists.** There is one toggle on the site — in the footer — and if a press
 * were the only way the theme ever moved, the press could just re-render it.
 * But `followSystem` below changes it too: somebody who has never chosen is
 * still following their operating system, and an OS that flips at sunset flips
 * the page under an open tab. Without this the page would change and the button
 * would go on offering the theme it is already in.
 *
 * It also keeps any two toggles in step, should a second one ever be drawn.
 *
 * A plain `Set` rather than a context: the theme is a property of the document,
 * not of a React subtree, and a provider would put every page under a re-render
 * for something that is already global.
 */
const listeners = new Set<() => void>()

const announce = () => {
  for (const listener of listeners) listener()
}

/** Choose a theme, and stop following the system from now on. */
export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Blocked storage costs the visitor the memory of the choice, not the
    // choice: the rest of this still runs and the page still changes.
  }

  applyTheme(theme)
  announce()
}

/**
 * Watch the operating system, for as long as the visitor has not overruled it.
 *
 * Called once from `main.tsx` rather than from a component, because it is about
 * the document and has to keep working on a page with no toggle rendered on it.
 * The guard is re-read inside the handler rather than captured: somebody can
 * press the toggle after this is wired up, and the listener has to notice.
 */
export function followSystem(): () => void {
  const query = darkQuery()
  if (!query) return () => {}

  const onChange = () => {
    if (storedTheme()) return
    applyTheme(systemTheme())
    announce()
  }

  query.addEventListener('change', onChange)
  return () => {
    query.removeEventListener('change', onChange)
  }
}

/**
 * The theme, for a component that draws it.
 *
 * `useSyncExternalStore` rather than `useState` plus an effect, because the
 * value already exists outside React — it is an attribute on `<html>`, put
 * there before this bundle was parsed. The server snapshot is the constant
 * `DARK`: there is no server rendering here today, and the honest answer to
 * "what theme is it" without a document is the one the site defaults to.
 */
export function useTheme(): Theme {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange)
      return () => {
        listeners.delete(onChange)
      }
    },
    currentTheme,
    () => DARK,
  )
}
