import { fireEvent, render as renderBare, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { SiteNav } from './SiteNav'
import { navLinks } from '../../content/home'

/**
 * The nav renders its links twice — once in the row that shows above the
 * breakpoint, once in the panel that shows below it — and CSS picks. Only one is
 * ever in the accessibility tree, because `display: none` takes the other out of
 * it, but jsdom applies no CSS, so every query here has to say which one it
 * means.
 */

/**
 * The nav is in the layout on every route, so half its links are `<Link>`s and
 * those throw outside a router. `MemoryRouter` keeps the history in memory,
 * which is what lets a test assert on where a link points without jsdom trying
 * to navigate anywhere.
 */
const render = () => renderBare(<SiteNav />, { wrapper: MemoryRouter })

const toggle = () => screen.getByRole('button', { name: /menu/i })

const panel = () =>
  document.getElementById(toggle().getAttribute('aria-controls')!)!

describe('SiteNav', () => {
  it('takes the masthead to the site root, not to an anchor on this page', () => {
    render()

    // `#top` would only ever scroll you to the top of the page you are on.
    expect(screen.getByRole('link', { name: /robotics club/i })).toHaveAttribute(
      'href',
      '/',
    )
  })

  it('starts with the menu shut', () => {
    render()

    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(panel()).toHaveClass('hidden')
  })

  it('opens and shuts on the toggle', () => {
    render()

    fireEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    expect(panel()).not.toHaveClass('hidden')

    fireEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
  })

  /**
   * The case that matters is the in-page anchor: it scrolls without unmounting
   * anything, so an open menu would sit over the section it just jumped to. A
   * link to a route replaces the page under it either way.
   */
  it('shuts itself when an anchor inside it is followed', () => {
    const anchor = navLinks.find((link) => link.href.includes('#'))
    expect(anchor).toBeDefined()

    render()

    fireEvent.click(toggle())
    fireEvent.click(within(panel()).getByRole('link', { name: anchor!.label }))

    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
  })

  it('shuts on Escape, so the trigger is not the only way out', () => {
    render()

    fireEvent.click(toggle())
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
  })

  it('carries every nav link in the panel, not just the wide row', () => {
    render()

    const links = within(panel()).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(
      navLinks.map((link) => link.label),
    )
  })

  /**
   * The join button is the reason the bar exists, so it survives at every width
   * — but "JOIN THE CLUB" and a masthead and a toggle do not fit across 320px,
   * which is why the short label exists.
   */
  it('keeps the join button at both widths, under two labels', () => {
    render()

    // It pointed at `#faq` for as long as there was nowhere to actually sign up.
    const join = screen.getByRole('link', { name: /join/i })
    expect(join).toHaveAttribute('href', '/join')
    expect(within(join).getByText('JOIN')).toHaveClass('wide:hidden')
    expect(within(join).getByText('JOIN THE CLUB')).toHaveClass('hidden')
  })
})
