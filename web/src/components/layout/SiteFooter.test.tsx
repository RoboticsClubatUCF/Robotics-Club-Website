import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SiteFooter } from './SiteFooter'
import { socialMarks } from './socialMarks'
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
      const anchor = screen.getByRole('link', { name: socialName(link.label) })

      expect(anchor, link.label).toHaveAttribute('target', '_blank')
      // `noopener` is the one that matters: without it the opened page can
      // navigate this one through `window.opener`.
      expect(anchor.getAttribute('rel'), link.label).toContain('noopener')
    }
  })

  /**
   * The row is four logos, so the *only* name each link has is the one the
   * anchor spells out — the glyph inside it is `aria-hidden`. Drop the
   * `aria-label` in a refactor and the footer keeps looking right while four of
   * its links go nameless, which is the kind of break nothing else here would
   * catch.
   */
  it('names each account in words, since the link no longer shows any', () => {
    render(<SiteFooter />)

    for (const link of socialLinks) {
      expect(
        screen.getByRole('link', { name: socialName(link.label) }),
        link.label,
      ).toBeInTheDocument()
    }
  })

  /**
   * `SiteFooter` falls back to the word for a label `socialMarks` doesn't know,
   * so a fifth account added to `content/home.ts` without a glyph ships as one
   * plain word in a row of logos rather than as a broken footer. That is the
   * right failure, but it is a quiet one — this is what says so out loud.
   */
  it('has a mark for every account in the list', () => {
    for (const link of socialLinks) {
      expect(socialMarks[link.label], link.label).toBeDefined()
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
      name: socialName(socialLinks[socialLinks.length - 1]!.label),
    })
    const toggle = screen.getByRole('button', { name: /switch to .* theme/i })

    expect(
      last.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })
})

/** What the anchor is named: the mark's own spelling, or the raw label where
    there is no mark and the footer prints the word instead. */
function socialName(label: string) {
  return socialMarks[label]?.name ?? label
}
