import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PartnersSection } from './PartnersSection'
import { partnerPrograms } from '../../content/home'

/**
 * The partner programs.
 *
 * Copy and no request, so most of this a build would catch. What is worth
 * pinning is the part the section exists for: the join page links at
 * `/#partners`, and the two things that make that link work — the anchor being
 * on this section, and every card carrying a way out to the program itself —
 * are exactly the things a refactor drops without breaking anything visible.
 */
describe('PartnersSection', () => {
  it('renders every program', () => {
    render(<PartnersSection />)

    expect(partnerPrograms.length).toBeGreaterThan(0)
    for (const program of partnerPrograms) {
      expect(
        screen.getByRole('heading', { name: program.name }),
        program.name,
      ).toBeInTheDocument()
      expect(screen.getByText(program.blurb)).toBeInTheDocument()
    }
  })

  /** The join page's link is `/#partners`, and this is the other half of it. */
  it('carries the anchor the join page points at', () => {
    const { container } = render(<PartnersSection />)

    expect(container.querySelector('section#partners')).not.toBeNull()
  })

  /**
   * The whole point of a card is the way out of it. Each link names its
   * program rather than reading "learn more", because a screen reader reads
   * these as a list of links with nothing else around them.
   */
  it('links out to each program by name', () => {
    render(<PartnersSection />)

    for (const program of partnerPrograms) {
      const link = screen.getByRole('link', { name: program.linkLabel })
      expect(link).toHaveAttribute('href', program.href)
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
    }
  })

  /**
   * A program with no artwork yet gets a held-open well, not a collapsed card
   * or a broken image — the same language the sponsor logos and the empty
   * officer seats use. Every program is a placeholder today, which is the
   * state this has to survive.
   */
  it('holds the image well open when there is no artwork', () => {
    render(<PartnersSection />)

    const missing = partnerPrograms.filter((program) => !program.imageUrl)
    expect(missing.length).toBeGreaterThan(0)
    expect(screen.getAllByText('[ IMAGE ]')).toHaveLength(missing.length)
  })
})
