import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeToggle } from './ThemeToggle'
import { DARK, LIGHT, STORAGE_KEY, followSystem } from '../../lib/theme'

/**
 * jsdom's own `matchMedia` answers `false` to every query, with listeners that
 * never fire — which would make the system look like it prefers light in every
 * test here, and make an OS change untestable. Replaced so each test can say
 * what the operating system is asking for, and change its mind.
 *
 * Returns the flip, the same shape `lib/theme.test.ts` uses.
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

  return (next: boolean) => {
    matches = next
    for (const listener of listeners) listener()
  }
}

beforeEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.theme
  document.head.innerHTML = '<meta name="theme-color" content="#0b0b0b">'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ThemeToggle', () => {
  /**
   * The decision this component rests on: the name is the *destination*, not
   * the current state. A button labelled with the theme you are already in and
   * one labelled with the theme you would get look identical and mean opposite
   * things.
   */
  it('offers the theme you are not in', () => {
    stubMatchMedia(true)

    render(<ThemeToggle />)

    expect(
      screen.getByRole('button', { name: 'Switch to light theme' }),
    ).toBeInTheDocument()
  })

  it('offers the dark theme when the page is already light', () => {
    stubMatchMedia(false)

    render(<ThemeToggle />)

    expect(
      screen.getByRole('button', { name: 'Switch to dark theme' }),
    ).toBeInTheDocument()
  })

  it('switches the document and remembers the choice', () => {
    stubMatchMedia(true)

    render(<ThemeToggle />)
    fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }))

    expect(document.documentElement.dataset.theme).toBe(LIGHT)
    expect(localStorage.getItem(STORAGE_KEY)).toBe(LIGHT)
  })

  it('relabels itself once pressed, so it can be pressed back', () => {
    stubMatchMedia(true)

    render(<ThemeToggle />)
    fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }))

    const back = screen.getByRole('button', { name: 'Switch to dark theme' })
    fireEvent.click(back)

    expect(document.documentElement.dataset.theme).toBe(DARK)
    expect(localStorage.getItem(STORAGE_KEY)).toBe(DARK)
  })

  /**
   * **The reason the module keeps a listener set.** A press is not the only
   * thing that moves the theme: somebody who has never chosen is still
   * following their operating system, and an OS that flips at sunset flips the
   * page under an open tab. Without the subscription the page would change and
   * the button would go on offering the theme it is already in.
   */
  it('relabels itself when the operating system changes under it', async () => {
    const flip = stubMatchMedia(true)
    const stop = followSystem()

    render(<ThemeToggle />)
    screen.getByRole('button', { name: 'Switch to light theme' })

    act(() => {
      flip(false)
    })

    expect(
      await screen.findByRole('button', { name: 'Switch to dark theme' }),
    ).toBeInTheDocument()
    stop()
  })

  /**
   * There is one of these on the site — the footer's — so this is a property of
   * the mechanism rather than of the current layout. It is worth pinning
   * anyway: the day a second switch is drawn anywhere, two buttons showing
   * opposite states is the bug, and it would be found here rather than on the
   * page.
   */
  it('keeps any two toggles in step', () => {
    stubMatchMedia(true)

    render(
      <>
        <ThemeToggle />
        <ThemeToggle />
      </>,
    )

    const [first] = screen.getAllByRole('button', { name: 'Switch to light theme' })
    fireEvent.click(first!)

    expect(
      screen.getAllByRole('button', { name: 'Switch to dark theme' }),
    ).toHaveLength(2)
  })

  /**
   * `aria-pressed` would announce this as a checkbox with a state, which is the
   * ambiguity the changing name exists to avoid — "pressed" reads as "the theme
   * this names is on" to exactly the people who most need it not to.
   */
  it('is a button with a changing name rather than a toggle with a state', () => {
    stubMatchMedia(true)

    render(<ThemeToggle />)

    expect(screen.getByRole('button')).not.toHaveAttribute('aria-pressed')
  })

  it('takes sizing from the call site, since the bar and the panel differ', () => {
    stubMatchMedia(true)

    render(<ThemeToggle className="size-11" />)

    expect(screen.getByRole('button')).toHaveClass('size-11')
  })
})
