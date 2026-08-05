import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SiteFooter } from './SiteFooter'
import { socialLinks } from '../content/home'

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
})
