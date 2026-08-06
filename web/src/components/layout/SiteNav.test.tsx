import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SiteNav } from './SiteNav'
import { navLinks } from '../content/home'

/**
 * The nav renders its links twice — once in the row that shows above the
 * breakpoint, once in the panel that shows below it — and CSS picks. Only one is
 * ever in the accessibility tree, because `display: none` takes the other out of
 * it, but jsdom applies no CSS, so every query here has to say which one it
 * means.
 */
const toggle = () => screen.getByRole('button', { name: /menu/i })

const panel = () =>
  document.getElementById(toggle().getAttribute('aria-controls')!)!

describe('SiteNav', () => {
  it('takes the masthead to the site root, not to an anchor on this page', () => {
    render(<SiteNav />)

    // `#top` would only ever scroll you to the top of the page you are on.
    expect(screen.getByRole('link', { name: /robotics club/i })).toHaveAttribute(
      'href',
      '/',
    )
  })

  it('starts with the menu shut', () => {
    render(<SiteNav />)

    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(panel()).toHaveClass('hidden')
  })

  it('opens and shuts on the toggle', () => {
    render(<SiteNav />)

    fireEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    expect(panel()).not.toHaveClass('hidden')

    fireEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
  })

  /**
   * The case that matters is the in-page anchor: it scrolls without unmounting
   * anything, so an open menu would sit over the section it just jumped to. A
   * link to a route takes the whole page with it either way.
   */
  it('shuts itself when an anchor inside it is followed', () => {
    const anchor = navLinks.find((link) => link.href.startsWith('#'))
    expect(anchor).toBeDefined()

    render(<SiteNav />)

    fireEvent.click(toggle())
    fireEvent.click(within(panel()).getByRole('link', { name: anchor!.label }))

    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
  })

  it('shuts on Escape, so the trigger is not the only way out', () => {
    render(<SiteNav />)

    fireEvent.click(toggle())
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
  })

  it('carries every nav link in the panel, not just the wide row', () => {
    render(<SiteNav />)

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
    render(<SiteNav />)

    const join = screen.getByRole('link', { name: /join/i })
    expect(join).toHaveAttribute('href', '#faq')
    expect(within(join).getByText('JOIN')).toHaveClass('wide:hidden')
    expect(within(join).getByText('JOIN THE CLUB')).toHaveClass('hidden')
  })
})
