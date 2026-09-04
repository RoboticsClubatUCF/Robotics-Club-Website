import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import indexHtml from '../../index.html?raw'
import {
  DARK,
  LIGHT,
  STORAGE_KEY,
  applyTheme,
  currentTheme,
  followSystem,
  setTheme,
  storedTheme,
  systemTheme,
} from './theme'

/**
 * A `matchMedia` that answers one way and can be made to change its mind.
 *
 * jsdom ships a `matchMedia` that parses the query and then answers `false` to everything, with
 * listeners that never fire — which is exactly the two things these tests are about. So it is
 * replaced outright rather than spied on.
 */
function stubMatchMedia(prefersDark: boolean) {
  const listeners = new Set<() => void>()
  let matches = prefersDark

  const query = {
    get matches() {
      return matches
    },
    addEventListener: (_: string, listener: () => void) => {
      listeners.add(listener)
    },
    removeEventListener: (_: string, listener: () => void) => {
      listeners.delete(listener)
    },
  }

  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => query),
  )

  /** The operating system changing under an open tab. */
  return (next: boolean) => {
    matches = next
    for (const listener of listeners) listener()
  }
}

const themeColour = () =>
  document.querySelector('meta[name="theme-color"]')?.getAttribute('content')

beforeEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.theme
  document.head.innerHTML = '<meta name="theme-color" content="#0b0b0b">'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('what theme is in force', () => {
  it('follows the system when nobody has chosen', () => {
    stubMatchMedia(false)
    expect(currentTheme()).toBe(LIGHT)

    stubMatchMedia(true)
    expect(currentTheme()).toBe(DARK)
  })

  it('prefers a stored choice over the system', () => {
    stubMatchMedia(true)
    localStorage.setItem(STORAGE_KEY, LIGHT)

    expect(currentTheme()).toBe(LIGHT)
  })

  /**
   * The fallback everywhere in this feature. A browser too old for `matchMedia`
   * gets the theme the site has always had, not an exception.
   */
  it('falls back to dark when the browser will not say', () => {
    vi.stubGlobal('matchMedia', undefined)

    expect(systemTheme()).toBe(DARK)
    expect(currentTheme()).toBe(DARK)
  })

  /** A value from an older build, or somebody editing storage by hand. */
  it('ignores a stored value that is not a theme', () => {
    stubMatchMedia(true)
    localStorage.setItem(STORAGE_KEY, 'solarized')

    expect(storedTheme()).toBeNull()
    expect(currentTheme()).toBe(DARK)
  })

  /**
   * A browser set to block site data throws on access rather than answering
   * empty, and a theme preference is not worth a blank page.
   */
  it('survives storage that throws on read', () => {
    stubMatchMedia(true)
    const getItem = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('blocked')
      })

    expect(storedTheme()).toBeNull()
    expect(currentTheme()).toBe(DARK)
    getItem.mockRestore()
  })
})

describe('applying a theme', () => {
  it('moves the attribute every colour hangs off', () => {
    applyTheme(LIGHT)
    expect(document.documentElement.dataset.theme).toBe(LIGHT)

    applyTheme(DARK)
    expect(document.documentElement.dataset.theme).toBe(DARK)
  })

  /** Left alone, the phone's address bar stays near-black over a white page,
      which reads as a page that failed to load. */
  it('repaints the browser chrome with it', () => {
    applyTheme(LIGHT)
    expect(themeColour()).toBe('#fbfaf8')

    applyTheme(DARK)
    expect(themeColour()).toBe('#0b0b0b')
  })

  it('does not throw on a page with no theme-color meta', () => {
    document.head.innerHTML = ''

    expect(() => {
      applyTheme(LIGHT)
    }).not.toThrow()
  })
})

describe('choosing a theme', () => {
  it('applies it and remembers it', () => {
    stubMatchMedia(true)

    setTheme(LIGHT)

    expect(document.documentElement.dataset.theme).toBe(LIGHT)
    expect(localStorage.getItem(STORAGE_KEY)).toBe(LIGHT)
  })

  // That a choice reaches everything drawing it is `ThemeToggle.test.tsx`: the
  // listener set is private, and the only honest way to observe it is through a
  // component that has subscribed to it.

  /** The choice still takes effect; only the memory of it is lost. */
  it('still switches when storage refuses the write', () => {
    stubMatchMedia(true)
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('blocked')
      })

    setTheme(LIGHT)

    expect(document.documentElement.dataset.theme).toBe(LIGHT)
    setItem.mockRestore()
  })
})

describe('following the system', () => {
  it('changes the page when the operating system changes', () => {
    const flip = stubMatchMedia(true)
    const stop = followSystem()

    flip(false)
    expect(document.documentElement.dataset.theme).toBe(LIGHT)

    flip(true)
    expect(document.documentElement.dataset.theme).toBe(DARK)
    stop()
  })

  /**
   * The half that makes the two-state toggle honest: pressing it opts out of
   * the system for good, so a later OS change must not undo the choice.
   */
  it('stops once the visitor has chosen', () => {
    const flip = stubMatchMedia(true)
    const stop = followSystem()

    setTheme(DARK)
    flip(false)

    expect(document.documentElement.dataset.theme).toBe(DARK)
    stop()
  })

  it('unsubscribes when told to', () => {
    const flip = stubMatchMedia(true)
    followSystem()()

    flip(false)
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })
})

/**
 * The inline script in `index.html` is a hand-kept copy of the rules above — it has to run before
 * the first paint, so it cannot import this module. Nothing but this can catch the two drifting: a
 * typo there is invisible until somebody with light mode on loads the site and watches it blink.
 *
 * Pinned by substring rather than by executing the script. Running it would prove the copy works
 * and not that it is the same copy, which is the failure worth catching — a script that reads
 * `theme` instead of `rccf-theme` works perfectly and forgets every choice on reload.
 */
describe('the pre-paint script in index.html', () => {
  it('uses the same storage key', () => {
    expect(indexHtml).toContain(`'${STORAGE_KEY}'`)
  })

  it('knows both theme names', () => {
    expect(indexHtml).toContain(`'${DARK}'`)
    expect(indexHtml).toContain(`'${LIGHT}'`)
  })

  it('consults the same media query', () => {
    expect(indexHtml).toContain('(prefers-color-scheme: dark)')
  })

  /** Blocking and in the head. A module, or anything deferred, paints first —
      which is the entire problem this script exists to solve. */
  it('is inline and unblocked by a module type', () => {
    expect(indexHtml).toMatch(/<script>\s*;?\(function/)
    expect(indexHtml.indexOf('rccf-theme')).toBeLessThan(indexHtml.indexOf('</head>'))
  })
})
