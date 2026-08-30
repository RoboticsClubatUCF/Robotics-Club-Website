import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SiteFooter } from './SiteFooter'
import { socialLinks } from '../../content/home'

/**
 * `target` and `rel` are the kind of attributes that vanish in a refactor and
 * take nothing visible with them — the link still works, it just stops opening
 * in a new tab and quietly hands the opened page a handle on this one.
 */
describe('SiteFooter', () => {
  it('sends every social link to its own tab, safely', () => {
    render(<SiteFooter />)

    expect(socialLinks.length).toBeGreaterThan(0)
    for (const link of socialLinks) {
      const anchor = screen.getByRole('link', { name: link.label })

      expect(anchor, link.label).toHaveAttribute('target', '_blank')
      // `noopener` is the one that matters: without it the opened page can
      // navigate this one through `window.opener`.
      expect(anchor.getAttribute('rel'), link.label).toContain('noopener')
    }
  })

  /**
   * The footer is the theme switch's only home on the site, and it is on every
   * route — so this is what says the control exists at all. It moved here from
   * the nav: it is a setting rather than a destination, and the bar is a row of
   * destinations that was already three things wide at 320px.
   */
  it('carries the theme switch', () => {
    render(<SiteFooter />)

    expect(screen.getByRole('button', { name: /switch to .* theme/i })).toBeInTheDocument()
  })

  /**
   * Bottom right, which means *after* the social links rather than beside them.
   * The two share a wrapper so the footer stays two children wide: a third
   * child under `justify-between` would strand the links in the middle of the
   * row at width.
   */
  it('puts it at the end of the row, past the last social link', () => {
    render(<SiteFooter />)

    const last = screen.getByRole('link', {
      name: socialLinks[socialLinks.length - 1]!.label,
    })
    const toggle = screen.getByRole('button', { name: /switch to .* theme/i })

    expect(
      last.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })
})
